import { Rule, RuleTargetInput, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { resolve } from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import {
  AccessLogFormat,
  EndpointType,
  LambdaRestApi,
  LogGroupLogDestination,
  MethodLoggingLevel,
} from "aws-cdk-lib/aws-apigateway";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";
import type { DataStack } from "./data-stack";
import type { IdentityStack } from "./identity-stack";
import type { StorageStack } from "./storage-stack";
import type { EmailStack } from "./email-stack";

export interface ApiStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly data: DataStack;
  readonly identity: IdentityStack;
  readonly storage: StorageStack;
  readonly email: EmailStack;
}
export class ApiStack extends Stack {
  readonly apiFunction: NodejsFunction;
  readonly api: LambdaRestApi;
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, data, identity, storage, email } = props;
    const senderContext: unknown = this.node.tryGetContext("sesSenderIdentity");
    const sesSenderIdentity =
      typeof senderContext === "string" ? senderContext.trim() : "";
    const root = resolve(import.meta.dirname, "../../../..");
    const functionLogs = new LogGroup(this, "ApiFunctionLogs", {
      retention: config.logRetention,
    });
    const providerKeys = new Secret(this, "ProviderKeys", {
      secretObjectValue: { openai: SecretValue.unsafePlainText("") },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    Validations.of(providerKeys).acknowledge({
      id: "AwsSolutions-SMG4",
      reason:
        "Provider credentials are rotated by placing a new secret version and recycling execution environments.",
    });
    new CfnOutput(this, "ProviderKeysSecretArn", {
      value: providerKeys.secretArn,
    });
    this.apiFunction = new NodejsFunction(this, "ApiFunction", {
      entry: resolve(root, "services/api/src/handlers/http.ts"),
      handler: "handler",
      projectRoot: root,
      depsLockFilePath: resolve(root, "pnpm-lock.yaml"),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(29),
      memorySize: 1024,
      bundling: { sourceMap: true, forceDockerBundling: false },
      logGroup: functionLogs,
      tracing: Tracing.ACTIVE,
      environment: {
        DATABASE_CLUSTER_ARN: data.cluster.clusterArn,
        APP_SECRET_ARN: data.appSecret.secretArn,
        PIPELINE_SECRET_ARN: data.pipelineSecret.secretArn,
        SCHEDULER_SECRET_ARN: data.schedulerSecret.secretArn,
        DATABASE_NAME: data.databaseName,
        DOCUMENTS_BUCKET_NAME: storage.documentsBucket.bucketName,
        DOCUMENT_KEY_PREFIX: "",
        ISSUED_BUCKET_NAME: storage.issuedBucket.bucketName,
        AUDIT_ANCHORS_BUCKET_NAME: storage.auditAnchorsBucket.bucketName,
        COGNITO_USER_POOL_ID: identity.userPool.userPoolId,
        COGNITO_CLIENT_IDS: Stack.of(this).toJsonString({
          web: identity.webClient.userPoolClientId,
          mobile: identity.mobileClient.userPoolClientId,
        }),
        APP_ORIGIN:
          config.stage === "dev"
            ? "https://dev.aqarak.ae"
            : "https://aqarak.ae",
        EMAIL_FROM_ADDRESS:
          config.stage === "dev"
            ? "notifications@dev.aqarak.ae"
            : "notifications@aqarak.ae",
        EMAIL_CONFIGURATION_SET: email.configurationSet.configurationSetName,
        PROVIDER_KEYS_SECRET_ARN: providerKeys.secretArn,
        EXTRACTION_TIMEOUT_MS: "20000",
        STAGE: config.stage,
        // AWS_REGION is supplied by the Lambda runtime and cannot be overridden.
      },
    });
    this.apiFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "rds-data:ExecuteStatement",
          "rds-data:BatchExecuteStatement",
          "rds-data:BeginTransaction",
          "rds-data:CommitTransaction",
          "rds-data:RollbackTransaction",
        ],
        resources: [data.cluster.clusterArn],
      }),
    );
    // Importing the app secret without its key keeps grants in this consuming stack.
    // The explicit KMS statement below authorises decryption without a reverse key-policy dependency.
    Secret.fromSecretCompleteArn(
      this,
      "AppDatabaseSecret",
      data.appSecret.secretArn,
    ).grantRead(this.apiFunction);
    for (const [id, secret] of [
      ["PipelineDatabaseSecret", data.pipelineSecret],
      ["SchedulerDatabaseSecret", data.schedulerSecret],
    ] as const) {
      Secret.fromSecretCompleteArn(this, id, secret.secretArn).grantRead(
        this.apiFunction,
      );
    }
    providerKeys.grantRead(this.apiFunction);
    this.apiFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: [
          this.formatArn({
            service: "ses",
            resource: "configuration-set",
            resourceName: email.configurationSet.configurationSetName,
          }),
          this.formatArn({
            service: "ses",
            resource: "identity",
            resourceName:
              config.stage === "dev" ? "dev.aqarak.ae" : "aqarak.ae",
          }),
          ...(config.stage === "dev" && sesSenderIdentity
            ? [
                this.formatArn({
                  service: "ses",
                  resource: "identity",
                  resourceName: sesSenderIdentity,
                }),
              ]
            : []),
        ],
      }),
    );
    new Rule(this, "DeliverPendingEmails", {
      schedule: Schedule.rate(Duration.minutes(5)),
      targets: [
        new LambdaFunction(this.apiFunction, {
          event: RuleTargetInput.fromObject({
            source: "aqarak.scheduler",
            action: "deliverPendingEmails",
          }),
          retryAttempts: 0,
        }),
      ],
    });
    this.apiFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:AdminRespondToAuthChallenge",
          "cognito-idp:AdminUserGlobalSignOut",
          "cognito-idp:AdminGetUser",
        ],
        resources: [identity.userPool.userPoolArn],
      }),
    );
    this.apiFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObject",
          "s3:GetObjectTagging",
          "s3:GetObjectVersionTagging",
        ],
        resources: [storage.documentsBucket.arnForObjects("*")],
      }),
    );
    this.apiFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"],
        resources: [
          storage.issuedBucket.arnForObjects("*"),
          storage.auditAnchorsBucket.arnForObjects("*"),
        ],
      }),
    );
    const encryptionKey = storage.documentsBucket.encryptionKey;
    if (!encryptionKey) throw new Error("Document encryption key is required");
    this.apiFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"],
        resources: [encryptionKey.keyArn],
      }),
    );
    const accessLogs = new LogGroup(this, "ApiAccessLogs", {
      retention: config.logRetention,
    });
    this.api = new LambdaRestApi(this, "RestApi", {
      handler: this.apiFunction,
      proxy: true,
      endpointTypes: [EndpointType.REGIONAL],
      cloudWatchRole: true,
      cloudWatchRoleRemovalPolicy: RemovalPolicy.RETAIN,
      deployOptions: {
        stageName: config.apiStageName,
        accessLogDestination: new LogGroupLogDestination(accessLogs),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,
        tracingEnabled: true,
        throttlingRateLimit: config.throttleRate,
        throttlingBurstLimit: config.throttleBurst,
      },
    });
    // The web ACL shares the API stack so its association follows the stage lifecycle.
    const visibility = (
      metricName: string,
    ): CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName,
    });
    const webAcl = new CfnWebACL(this, "WebAcl", {
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: visibility(`aqarak-${config.stage}-api`),
      rules: [
        {
          name: "AWSManagedRulesAmazonIpReputationList",
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesAmazonIpReputationList",
            },
          },
          visibilityConfig: visibility("AmazonIpReputationList"),
        },
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
              // JSON bodies above 8 KB are legitimate and validated by the application.
              ruleActionOverrides: [
                { name: "SizeRestrictions_BODY", actionToUse: { count: {} } },
              ],
            },
          },
          visibilityConfig: visibility("CommonRuleSet"),
        },
        {
          name: "AWSManagedRulesKnownBadInputsRuleSet",
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesKnownBadInputsRuleSet",
            },
          },
          visibilityConfig: visibility("KnownBadInputsRuleSet"),
        },
        {
          name: "RateLimitPerIp",
          priority: 3,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              // Shared hosting addresses serve the web backend-for-frontend, so the limit is generous.
              limit: 2000,
              evaluationWindowSec: 300,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: visibility("RateLimitPerIp"),
        },
      ],
    });
    const webAclAssociation = new CfnWebACLAssociation(
      this,
      "WebAclAssociation",
      {
        resourceArn: this.api.deploymentStage.stageArn,
        webAclArn: webAcl.attrArn,
      },
    );
    webAclAssociation.node.addDependency(this.api.deploymentStage);
    Validations.of(this.api).acknowledge({
      id: "AwsSolutions-APIG2",
      reason:
        "Application zod schemas validate request payloads; the foundation handler currently exposes the public health route.",
    });
    Validations.of(this.api).acknowledge({
      id: "AwsSolutions-APIG4",
      reason:
        "Authentication is reserved for the application through the web backend-for-frontend session and handler JWT verification; /v1/health is public. Protected routes must implement that verification before release.",
    });
    Validations.of(this.api).acknowledge({
      id: "AwsSolutions-COG4",
      reason:
        "Authentication is reserved for the application through the web backend-for-frontend session and handler JWT verification; /v1/health is public. Protected routes must implement that verification before release.",
    });
    // API Gateway requires this name for its execution log destination.
    const executionLogs = new LogGroup(this, "ApiExecutionLogs", {
      logGroupName: `API-Gateway-Execution-Logs_${this.api.restApiId}/${config.apiStageName}`,
      retention: config.logRetention,
    });
    this.api.deploymentStage.node.addDependency(executionLogs);
    const functionRole = this.apiFunction.node.findChild("ServiceRole");
    Validations.of(functionRole).acknowledge({
      id: "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
      reason:
        "The standard Lambda basic execution policy provides runtime log delivery; application resource permissions are explicit statements.",
    });
    const functionPolicy = functionRole.node.findChild("DefaultPolicy");
    Validations.of(functionPolicy).acknowledge({
      id: "AwsSolutions-IAM5[Resource::*]",
      reason:
        "X-Ray trace delivery requires PutTraceSegments and PutTelemetryRecords, which do not support resource-level ARNs.",
    });
    // Resolve only this known bucket scope after cross-stack references are prepared.
    this.node.addValidation({
      validate: (): string[] => {
        for (const bucket of [
          storage.documentsBucket,
          storage.issuedBucket,
          storage.auditAnchorsBucket,
        ]) {
          const bucketArn: unknown = this.resolve(bucket.bucketArn);
          Validations.of(functionPolicy).acknowledge({
            id: `AwsSolutions-IAM5[Resource::${typeof bucketArn === "string" ? bucketArn : JSON.stringify(bucketArn)}/*]`,
            reason:
              "GetObject, GetObjectVersion and PutObject are limited to documents in this one bucket. Object identifiers are allocated at runtime and checked by application authorisation.",
          });
        }
        return [];
      },
    });
    Validations.of(this.api.node.findChild("CloudWatchRole")).acknowledge({
      id: "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs]",
      reason:
        "The retained API Gateway regional logging role uses its standard service policy to deliver access and execution logs.",
    });
    new CfnOutput(this, "ApiUrl", { value: this.api.url });
    new CfnOutput(this, "WebAclArn", { value: webAcl.attrArn });
    new CfnOutput(this, "ApiFunctionName", {
      value: this.apiFunction.functionName,
    });
  }
}
