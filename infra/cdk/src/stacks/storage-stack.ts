import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import { CfnMalwareProtectionPlan } from "aws-cdk-lib/aws-guardduty";
import {
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  CfnBucket,
  HttpMethods,
  ObjectLockMode,
  ObjectLockRetention,
  ObjectOwnership,
  type IBucket,
} from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";

export interface StorageStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly dataKey: IKey;
  readonly accessLogsBucket: IBucket;
}
export class StorageStack extends Stack {
  readonly documentsBucket: Bucket;
  readonly issuedBucket: Bucket;
  readonly auditAnchorsBucket: Bucket;
  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    const common = {
      encryption: BucketEncryption.KMS,
      encryptionKey: props.dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      serverAccessLogsBucket: props.accessLogsBucket,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    };
    this.documentsBucket = new Bucket(this, "DocumentsBucket", {
      ...common,
      serverAccessLogsPrefix: "documents/",
      cors: [
        {
          allowedOrigins: props.config.corsOrigins,
          allowedMethods: [HttpMethods.PUT, HttpMethods.GET, HttpMethods.HEAD],
          allowedHeaders: [
            "content-type",
            "x-amz-checksum-sha256",
            "x-amz-sdk-checksum-algorithm",
          ],
          exposedHeaders: ["ETag", "x-amz-version-id", "x-amz-checksum-sha256"],
        },
      ],
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
        {
          prefix: "transient/",
          expiration: Duration.days(1),
          noncurrentVersionExpiration: Duration.days(1),
        },
        {
          prefix: "model-io/",
          expiration: Duration.days(90),
          noncurrentVersionExpiration: Duration.days(90),
        },
      ],
    });
    const malwareProtectionPrincipal =
      "malware-protection-plan.guardduty.amazonaws.com";
    const managedRuleArn = this.formatArn({
      service: "events",
      resource: "rule",
      resourceName: "DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*",
    });
    // These statements follow the GuardDuty service-role policy for one SSE-KMS bucket.
    // https://docs.aws.amazon.com/guardduty/latest/ug/malware-protection-s3-iam-policy-prerequisite.html
    const scanRole = new Role(this, "MalwareProtectionRole", {
      assumedBy: new ServicePrincipal(malwareProtectionPrincipal),
      inlinePolicies: {
        MalwareProtection: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: "AllowManagedRuleToSendS3EventsToGuardDuty",
              actions: [
                "events:PutRule",
                "events:DeleteRule",
                "events:PutTargets",
                "events:RemoveTargets",
              ],
              resources: [managedRuleArn],
              conditions: {
                StringLike: { "events:ManagedBy": malwareProtectionPrincipal },
              },
            }),
            new PolicyStatement({
              sid: "AllowGuardDutyToMonitorEventBridgeManagedRule",
              actions: ["events:DescribeRule", "events:ListTargetsByRule"],
              resources: [managedRuleArn],
            }),
            new PolicyStatement({
              sid: "AllowPostScanTag",
              actions: [
                "s3:PutObjectTagging",
                "s3:GetObjectTagging",
                "s3:PutObjectVersionTagging",
                "s3:GetObjectVersionTagging",
              ],
              resources: [this.documentsBucket.arnForObjects("*")],
            }),
            new PolicyStatement({
              sid: "AllowEnableS3EventBridgeEvents",
              actions: ["s3:PutBucketNotification", "s3:GetBucketNotification"],
              resources: [this.documentsBucket.bucketArn],
            }),
            new PolicyStatement({
              sid: "AllowPutValidationObject",
              actions: ["s3:PutObject"],
              resources: [
                this.documentsBucket.arnForObjects(
                  "malware-protection-resource-validation-object",
                ),
              ],
            }),
            new PolicyStatement({
              sid: "AllowCheckBucketOwnership",
              actions: ["s3:ListBucket"],
              resources: [this.documentsBucket.bucketArn],
            }),
            new PolicyStatement({
              sid: "AllowMalwareScan",
              actions: ["s3:GetObject", "s3:GetObjectVersion"],
              resources: [this.documentsBucket.arnForObjects("*")],
            }),
            new PolicyStatement({
              sid: "AllowDecryptForMalwareScan",
              actions: ["kms:GenerateDataKey", "kms:Decrypt"],
              resources: [props.dataKey.keyArn],
              conditions: {
                StringLike: {
                  "kms:ViaService": `s3.${this.region}.amazonaws.com`,
                },
              },
            }),
          ],
        }),
      },
    });
    Validations.of(scanRole).acknowledge({
      id: `AwsSolutions-IAM5[Resource::arn:aws:events:${props.config.region}:${props.config.account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*]`,
      reason:
        "GuardDuty chooses the managed-rule suffix. The documented EventBridge resource pattern is limited to this account and region; mutations also require the GuardDuty ManagedBy condition.",
    });
    const documentsResource = this.documentsBucket.node
      .defaultChild as CfnBucket;
    Validations.of(scanRole).acknowledge({
      id: `AwsSolutions-IAM5[Resource::<${this.getLogicalId(documentsResource)}.Arn>/*]`,
      reason:
        "GuardDuty must read and tag every uploaded object and version in this documents bucket. Object keys are allocated at runtime, and the plan intentionally has no prefix filter.",
    });
    const malwareProtectionPlan = new CfnMalwareProtectionPlan(
      this,
      "MalwareProtectionPlan",
      {
        role: scanRole.roleArn,
        protectedResource: {
          s3Bucket: { bucketName: this.documentsBucket.bucketName },
        },
        actions: { tagging: { status: "ENABLED" } },
      },
    );
    // The inline policy is created with the role before GuardDuty validates access.
    malwareProtectionPlan.node.addDependency(scanRole);
    new CfnOutput(this, "MalwareProtectionPlanId", {
      value: malwareProtectionPlan.attrMalwareProtectionPlanId,
    });
    // Compliance retention cannot be shortened or removed once it applies to an object version.
    const retention =
      props.config.objectLockMode === ObjectLockMode.COMPLIANCE
        ? ObjectLockRetention.compliance(
            Duration.days(props.config.objectLockDays),
          )
        : ObjectLockRetention.governance(
            Duration.days(props.config.objectLockDays),
          );
    this.issuedBucket = new Bucket(this, "IssuedBucket", {
      ...common,
      serverAccessLogsPrefix: "issued/",
      objectLockEnabled: true,
      objectLockDefaultRetention: retention,
    });
    this.auditAnchorsBucket = new Bucket(this, "AuditAnchorsBucket", {
      ...common,
      serverAccessLogsPrefix: "audit-anchors/",
      objectLockEnabled: true,
      objectLockDefaultRetention: retention,
    });
    for (const [name, value] of Object.entries({
      DocumentsBucketName: this.documentsBucket.bucketName,
      IssuedBucketName: this.issuedBucket.bucketName,
      AuditAnchorsBucketName: this.auditAnchorsBucket.bucketName,
    }))
      new CfnOutput(this, name, { value });
  }
}
