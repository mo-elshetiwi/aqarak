import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, it, expect, vi } from "vitest";
import { App, Validations } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { AqarakStage } from "./aqarak-stage";
import { devConfig, prodConfig } from "./config";

const context = z
  .object({ context: z.record(z.string(), z.unknown()) })
  .parse(
    JSON.parse(readFileSync(new URL("../cdk.json", import.meta.url), "utf8")),
  ).context;
function testApp(): App {
  return new App({ context });
}

const environments = [
  ["Dev", devConfig],
  ["Prod", prodConfig],
] as const;

describe("environment stages", () => {
  it.each(environments)("synthesises eight stacks for %s", (name, config) => {
    const stage = new AqarakStage(testApp(), name, { config });
    const assembly = stage.synth();
    expect(assembly.stacks).toHaveLength(8);
    expect(assembly.manifest.missing ?? []).toEqual([]);
  });
  it.each([
    ["Dev", devConfig, undefined, 2],
    ["Dev", devConfig, "", 2],
    ["Dev", devConfig, "   ", 2],
    ["Dev", devConfig, "release@example.com", 3],
    ["Prod", prodConfig, "release@example.com", 2],
  ] as const)(
    "scopes %s SES resources with sender context %s",
    (name, config, sender, resourceCount) => {
      const app = new App({
        context: {
          ...context,
          ...(sender === undefined ? {} : { sesSenderIdentity: sender }),
        },
      });
      const stage = new AqarakStage(app, name, { config });
      const template = Template.fromStack(stage.api);
      const policies = z
        .record(
          z.string(),
          z.object({
            Properties: z.object({
              PolicyDocument: z.object({
                Statement: z.array(
                  z.object({
                    Action: z.union([z.string(), z.array(z.string())]),
                    Resource: z.unknown(),
                  }),
                ),
              }),
            }),
          }),
        )
        .parse(template.findResources("AWS::IAM::Policy"));
      const statements = Object.values(policies).flatMap(
        (policy) => policy.Properties.PolicyDocument.Statement,
      );
      const ses = statements.filter((statement) =>
        [statement.Action].flat().includes("ses:SendEmail"),
      );
      expect(ses).toHaveLength(1);
      expect(ses[0]?.Resource).toHaveLength(resourceCount);
      const resources = JSON.stringify(ses[0]?.Resource);
      expect(resources).toContain("configuration-set/");
      expect(resources).toContain(
        config.stage === "dev"
          ? "identity/dev.aqarak.ae"
          : "identity/aqarak.ae",
      );
      if (resourceCount === 3)
        expect(resources).toContain("identity/release@example.com");
      else expect(resources).not.toContain("identity/release@example.com");
    },
  );
  it("holds a retained rotating key and access log bucket in the foundation", () => {
    const stage = new AqarakStage(testApp(), "Dev", { config: devConfig });
    const template = Template.fromStack(stage.foundation);
    template.resourceCountIs("AWS::KMS::Key", 1);
    template.hasResource("AWS::KMS::Key", {
      DeletionPolicy: "Retain",
      Properties: { EnableKeyRotation: true },
    });
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: 90 })]),
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });
  it.each(environments)(
    "AC-2 %s uses isolated networking and explicit log retention",
    (name, config) => {
      const stage = new AqarakStage(testApp(), name, { config });
      for (const stack of [
        stage.foundation,
        stage.network,
        stage.data,
        stage.databaseOps,
        stage.identity,
        stage.storage,
        stage.email,
        stage.api,
      ]) {
        const template = Template.fromStack(stack);
        for (const type of [
          "AWS::EC2::NatGateway",
          "AWS::EC2::InternetGateway",
          "Custom::LogRetention",
        ])
          template.resourceCountIs(type, 0);
        const groups: Record<
          string,
          { Properties?: { RetentionInDays?: number } }
        > = template.findResources("AWS::Logs::LogGroup");
        for (const group of Object.values(groups))
          expect(group.Properties?.RetentionInDays).toBe(config.logRetention);
      }
      Template.fromStack(stage.network).resourceCountIs("AWS::EC2::Subnet", 2);
      Template.fromStack(stage.network).hasResourceProperties(
        "AWS::EC2::VPCEndpoint",
        { VpcEndpointType: "Gateway" },
      );
      Template.fromStack(stage.network).resourceCountIs("AWS::EC2::FlowLog", 1);
    },
  );
  it.each(environments)(
    "AC-3 %s protects encrypted Aurora and four role secrets",
    (name, config) => {
      const stage = new AqarakStage(testApp(), name, { config });
      const template = Template.fromStack(stage.data);
      expect(stage.data.terminationProtection).toBe(true);
      template.resourceCountIs("AWS::SecretsManager::Secret", 4);
      template.resourceCountIs("AWS::RDS::DBInstance", 1);
      template.hasResourceProperties("AWS::RDS::DBInstance", {
        DBInstanceClass: "db.serverless",
        PubliclyAccessible: false,
      });
      template.hasResource("AWS::RDS::DBCluster", {
        DeletionPolicy: "Snapshot",
        UpdateReplacePolicy: "Snapshot",
        Properties: Match.objectLike({
          Engine: "aurora-postgresql",
          EngineVersion: "17.9",
          EnableHttpEndpoint: true,
          StorageEncrypted: true,
          KmsKeyId: Match.anyValue(),
          DatabaseName: "aqarak",
          ServerlessV2ScalingConfiguration: Match.objectLike({
            MinCapacity: config.databaseMinCapacity,
            MaxCapacity: 4,
          }),
          DeletionProtection: config.deletionProtection,
          BackupRetentionPeriod: config.databaseBackupDays,
          EnableIAMDatabaseAuthentication: false,
        }),
      });
      if (config.databaseAutoPauseDuration)
        template.hasResourceProperties("AWS::RDS::DBCluster", {
          ServerlessV2ScalingConfiguration: {
            MinCapacity: 0,
            MaxCapacity: 4,
            SecondsUntilAutoPause: 3600,
          },
        });
      template.hasResourceProperties("AWS::RDS::DBClusterParameterGroup", {
        Parameters: { timezone: "UTC", "rds.force_ssl": "1" },
      });
      template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupIngress: Match.absent(),
      });
      for (const output of [
        "ClusterArn",
        "ClusterIdentifier",
        "MasterSecretArn",
        "AppSecretArn",
        "PipelineSecretArn",
        "SchedulerSecretArn",
        "DatabaseName",
        "DataKeyArn",
      ])
        template.hasOutput(output, {});
      for (const username of [
        "aqarak_app",
        "aqarak_pipeline",
        "aqarak_scheduler",
      ])
        template.hasResourceProperties("AWS::SecretsManager::Secret", {
          KmsKeyId: Match.anyValue(),
          GenerateSecretString: Match.objectLike({
            SecretStringTemplate: JSON.stringify({ username }),
            ExcludeCharacters: " !\"#$%&'()*+,/:;<=>?@[\\]^`{|}",
          }),
        });
    },
  );
  it.each(environments)(
    "AC-4 %s uses verified email and two public admin-password clients",
    (name, config) => {
      const stage = new AqarakStage(testApp(), name, { config });
      const template = Template.fromStack(stage.identity);
      template.resourceCountIs("AWS::Cognito::UserPoolGroup", 0);
      template.resourceCountIs("AWS::Cognito::UserPoolDomain", 0);
      template.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", 0);
      template.hasResource("AWS::Cognito::UserPool", {
        DeletionPolicy: "Retain",
        Properties: Match.objectLike({
          UserPoolTier: "ESSENTIALS",
          UsernameAttributes: ["email"],
          AutoVerifiedAttributes: ["email"],
          AdminCreateUserConfig: Match.objectLike({
            AllowAdminCreateUserOnly: false,
          }),
          MfaConfiguration: "OPTIONAL",
          EnabledMfas: ["SOFTWARE_TOKEN_MFA"],
          DeletionProtection: config.deletionProtection ? "ACTIVE" : "INACTIVE",
          AccountRecoverySetting: {
            RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }],
          },
          Policies: {
            PasswordPolicy: Match.objectLike({
              MinimumLength: 12,
              RequireLowercase: true,
              RequireUppercase: true,
              RequireNumbers: true,
              RequireSymbols: true,
            }),
          },
          EmailConfiguration: Match.objectLike({
            EmailSendingAccount:
              config.email.mode === "ses" ? "DEVELOPER" : "COGNITO_DEFAULT",
          }),
        }),
      });
      template.resourceCountIs("AWS::Cognito::UserPoolClient", 2);
      template.allResourcesProperties("AWS::Cognito::UserPoolClient", {
        GenerateSecret: false,
        ExplicitAuthFlows: [
          "ALLOW_ADMIN_USER_PASSWORD_AUTH",
          "ALLOW_REFRESH_TOKEN_AUTH",
        ],
        AllowedOAuthFlowsUserPoolClient: false,
        EnableTokenRevocation: true,
        PreventUserExistenceErrors: "ENABLED",
        AccessTokenValidity: 60,
        IdTokenValidity: 60,
      });
      for (const days of [7, 30])
        template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
          RefreshTokenValidity: days * 24 * 60,
        });
      const poolSchema = z.record(
        z.string(),
        z.object({
          Properties: z.object({
            VerificationMessageTemplate: z.object({ EmailMessage: z.string() }),
            AdminCreateUserConfig: z.object({
              InviteMessageTemplate: z.object({ EmailMessage: z.string() }),
            }),
          }),
        }),
      );
      const pools = poolSchema.parse(
        template.findResources("AWS::Cognito::UserPool"),
      );
      for (const pool of Object.values(pools)) {
        expect(
          pool.Properties.VerificationMessageTemplate.EmailMessage,
        ).toMatch(/[\u0600-\u06FF]/);
        expect(
          pool.Properties.AdminCreateUserConfig.InviteMessageTemplate
            .EmailMessage,
        ).toMatch(/[\u0600-\u06FF]/);
      }
    },
  );

  it.each(environments)(
    "AC-5 %s retains private encrypted buckets and object locks",
    (name, config) => {
      const stage = new AqarakStage(testApp(), name, { config });
      for (const stack of [stage.foundation, stage.storage]) {
        const template = Template.fromStack(stack);
        template.allResources("AWS::S3::Bucket", { DeletionPolicy: "Retain" });
        template.allResourcesProperties("AWS::S3::Bucket", {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
          BucketEncryption: Match.anyValue(),
        });
        template.allResourcesProperties("AWS::S3::BucketPolicy", {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Deny",
                Principal: { AWS: "*" },
                Action: "s3:*",
                Condition: { Bool: { "aws:SecureTransport": "false" } },
              }),
            ]),
          },
        });
      }
      const storage = Template.fromStack(stage.storage);
      storage.resourceCountIs("AWS::S3::Bucket", 3);
      storage.allResourcesProperties("AWS::S3::Bucket", {
        VersioningConfiguration: { Status: "Enabled" },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              BucketKeyEnabled: true,
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "aws:kms",
                KMSMasterKeyID: Match.anyValue(),
              },
            },
          ],
        },
        OwnershipControls: {
          Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
        },
        LoggingConfiguration: {
          DestinationBucketName: Match.anyValue(),
          LogFilePrefix: Match.anyValue(),
        },
      });
      for (const prefix of ["issued/", "audit-anchors/"])
        storage.hasResourceProperties("AWS::S3::Bucket", {
          LoggingConfiguration: Match.objectLike({ LogFilePrefix: prefix }),
          CorsConfiguration: Match.absent(),
          ObjectLockEnabled: true,
          ObjectLockConfiguration: {
            ObjectLockEnabled: "Enabled",
            Rule: {
              DefaultRetention: {
                Mode: config.objectLockMode,
                Days: config.objectLockDays,
              },
            },
          },
        });
      storage.hasResourceProperties("AWS::S3::Bucket", {
        LoggingConfiguration: Match.objectLike({ LogFilePrefix: "documents/" }),
        CorsConfiguration: {
          CorsRules: [
            {
              AllowedOrigins:
                config.stage === "dev"
                  ? [
                      "http://localhost:3000",
                      "http://127.0.0.1:3000",
                      "https://*.vercel.app",
                      "https://aqarak.ae",
                      "https://www.aqarak.ae",
                    ]
                  : ["https://aqarak.ae", "https://www.aqarak.ae"],
              AllowedMethods: ["PUT", "GET", "HEAD"],
              AllowedHeaders: [
                "content-type",
                "x-amz-checksum-sha256",
                "x-amz-sdk-checksum-algorithm",
              ],
              ExposedHeaders: [
                "ETag",
                "x-amz-version-id",
                "x-amz-checksum-sha256",
              ],
            },
          ],
        },
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            }),
            Match.objectLike({ Prefix: "transient/", ExpirationInDays: 1 }),
            Match.objectLike({ Prefix: "model-io/", ExpirationInDays: 90 }),
          ]),
        },
      });
    },
  );

  it.each(environments)(
    "AC-6 %s limits API credentials and enables access logs and throttling",
    (name, config) => {
      const stage = new AqarakStage(testApp(), name, { config });
      const template = Template.fromStack(stage.api);
      template.resourceCountIs("AWS::Lambda::Function", 1);
      template.hasResourceProperties("AWS::Lambda::Function", {
        Runtime: "nodejs24.x",
        Architectures: ["arm64"],
        MemorySize: 1024,
        Timeout: 29,
        Environment: {
          Variables: Match.objectEquals({
            DOCUMENT_KEY_PREFIX: "",
            EMAIL_FROM_ADDRESS:
              config.stage === "dev"
                ? "notifications@dev.aqarak.ae"
                : "notifications@aqarak.ae",
            DATABASE_NAME: "aqarak",
            DATABASE_CLUSTER_ARN: Match.anyValue(),
            APP_SECRET_ARN: Match.anyValue(),
            COGNITO_USER_POOL_ID: Match.anyValue(),
            COGNITO_CLIENT_IDS: Match.anyValue(),
            PIPELINE_SECRET_ARN: Match.anyValue(),
            SCHEDULER_SECRET_ARN: Match.anyValue(),
            PROVIDER_KEYS_SECRET_ARN: Match.anyValue(),
            AUDIT_ANCHORS_BUCKET_NAME: Match.anyValue(),
            APP_ORIGIN:
              config.stage === "dev"
                ? "https://dev.aqarak.ae"
                : "https://aqarak.ae",
            EXTRACTION_TIMEOUT_MS: "20000",
            STAGE: config.stage,
            DOCUMENTS_BUCKET_NAME: Match.anyValue(),
            ISSUED_BUCKET_NAME: Match.anyValue(),
            EMAIL_CONFIGURATION_SET: Match.anyValue(),
          }),
        },
      });
      const policies = template.findResources("AWS::IAM::Policy");
      const serialised = JSON.stringify(policies);
      expect(serialised).toContain("AppSecret");
      expect(serialised).not.toContain("MasterSecret");
      for (const name of ["PipelineSecret", "SchedulerSecret", "ProviderKeys"])
        expect(serialised).toContain(name);
      expect(serialised).toContain("s3:GetObjectTagging");
      expect(serialised).toContain("s3:GetObjectVersionTagging");
      expect(serialised).toContain("ses:SendEmail");
      expect(serialised).toContain("ses:SendRawEmail");
      template.hasResourceProperties("AWS::Events::Rule", {
        ScheduleExpression: "rate(5 minutes)",
        Targets: Match.arrayWith([
          Match.objectLike({
            Input: JSON.stringify({
              source: "aqarak.scheduler",
              action: "deliverPendingEmails",
            }),
          }),
        ]),
      });
      const policySchema = z.record(
        z.string(),
        z.object({
          Properties: z.object({
            PolicyDocument: z.object({
              Statement: z.array(
                z.object({
                  Action: z.union([z.string(), z.array(z.string())]),
                  Resource: z.unknown(),
                }),
              ),
            }),
          }),
        }),
      );
      const statements = Object.values(policySchema.parse(policies)).flatMap(
        (policy) => policy.Properties.PolicyDocument.Statement,
      );
      const secretStatements = statements.filter((statement) =>
        [statement.Action].flat().includes("secretsmanager:GetSecretValue"),
      );
      expect(secretStatements.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(secretStatements)).toContain("ProviderKeys");
      expect(JSON.stringify(secretStatements[0]?.Resource)).toContain(
        "AppSecret",
      );
      expect(JSON.stringify(secretStatements[0]?.Resource)).not.toContain("*");
      const dataStatements = statements.filter((statement) =>
        [statement.Action].flat().includes("rds-data:ExecuteStatement"),
      );
      expect(dataStatements).toHaveLength(1);
      expect(dataStatements[0]?.Action).toEqual([
        "rds-data:BatchExecuteStatement",
        "rds-data:BeginTransaction",
        "rds-data:CommitTransaction",
        "rds-data:ExecuteStatement",
        "rds-data:RollbackTransaction",
      ]);
      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        StageName: config.apiStageName,
        TracingEnabled: true,
        AccessLogSetting: {
          DestinationArn: Match.anyValue(),
          Format: Match.anyValue(),
        },
        MethodSettings: Match.arrayWith([
          Match.objectLike({
            LoggingLevel: "ERROR",
            DataTraceEnabled: false,
            ThrottlingRateLimit: config.throttleRate,
            ThrottlingBurstLimit: config.throttleBurst,
          }),
        ]),
      });
      template.hasResource("AWS::IAM::Role", {
        DeletionPolicy: "Retain",
        Properties: Match.objectLike({
          AssumeRolePolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Principal: { Service: "apigateway.amazonaws.com" },
              }),
            ]),
          },
        }),
      });
    },
  );

  it.each(environments)(
    "%s sends all required email events to the default bus without identities",
    (name, config) => {
      const stage = new AqarakStage(testApp(), name, { config });
      const template = Template.fromStack(stage.email);
      template.resourceCountIs("AWS::SES::EmailIdentity", 0);
      template.resourceCountIs("AWS::Route53::RecordSet", 0);
      template.hasResourceProperties("AWS::SES::ConfigurationSet", {
        ReputationOptions: { ReputationMetricsEnabled: true },
        SendingOptions: { SendingEnabled: true },
        SuppressionOptions: { SuppressedReasons: ["BOUNCE", "COMPLAINT"] },
        DeliveryOptions: { TlsPolicy: "REQUIRE" },
      });
      template.hasResourceProperties(
        "AWS::SES::ConfigurationSetEventDestination",
        {
          EventDestination: Match.objectLike({
            Enabled: true,
            MatchingEventTypes: [
              "send",
              "delivery",
              "bounce",
              "complaint",
              "reject",
              "renderingFailure",
              "deliveryDelay",
            ],
            EventBridgeDestination: { EventBusArn: Match.anyValue() },
          }),
        },
      );
    },
  );

  it.each(environments)(
    "%s associates the regional web ACL with the API stage",
    (name, config) => {
      const stage = new AqarakStage(testApp(), name, { config });
      const template = Template.fromStack(stage.api);
      template.resourceCountIs("AWS::WAFv2::WebACL", 1);
      template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1);
      const visibility = {
        CloudWatchMetricsEnabled: true,
        SampledRequestsEnabled: true,
        MetricName: Match.anyValue(),
      };
      const managedRule = (
        ruleName: string,
        priority: number,
        overrides = {},
      ) => ({
        Name: ruleName,
        Priority: priority,
        OverrideAction: { None: {} },
        Statement: {
          ManagedRuleGroupStatement: {
            VendorName: "AWS",
            Name: ruleName,
            ...overrides,
          },
        },
        VisibilityConfig: visibility,
      });
      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Scope: "REGIONAL",
        DefaultAction: { Allow: {} },
        VisibilityConfig: visibility,
        Rules: [
          managedRule("AWSManagedRulesAmazonIpReputationList", 0),
          managedRule("AWSManagedRulesCommonRuleSet", 1, {
            RuleActionOverrides: [
              { Name: "SizeRestrictions_BODY", ActionToUse: { Count: {} } },
            ],
          }),
          managedRule("AWSManagedRulesKnownBadInputsRuleSet", 2),
          {
            Name: "RateLimitPerIp",
            Priority: 3,
            Action: { Block: {} },
            Statement: {
              RateBasedStatement: {
                Limit: 2000,
                EvaluationWindowSec: 300,
                AggregateKeyType: "IP",
              },
            },
            VisibilityConfig: visibility,
          },
        ],
      });
      const apiId = Object.keys(
        template.findResources("AWS::ApiGateway::RestApi"),
      )[0];
      const stageId = Object.keys(
        template.findResources("AWS::ApiGateway::Stage"),
      )[0];
      const aclId = Object.keys(
        template.findResources("AWS::WAFv2::WebACL"),
      )[0];
      template.hasResource("AWS::WAFv2::WebACLAssociation", {
        Properties: {
          ResourceArn: {
            "Fn::Join": [
              "",
              [
                `arn:aws:apigateway:${config.region}::/restapis/`,
                { Ref: apiId },
                "/stages/",
                { Ref: stageId },
              ],
            ],
          },
          WebACLArn: { "Fn::GetAtt": [aclId, "Arn"] },
        },
        DependsOn: Match.arrayWith([stageId]),
      });
      template.hasOutput("WebAclArn", {
        Value: { "Fn::GetAtt": [aclId, "Arn"] },
      });
    },
  );

  it.each(environments)(
    "%s scans and tags only documents with the documented service role",
    (name, config) => {
      const stage = new AqarakStage(testApp(), name, { config });
      const template = Template.fromStack(stage.storage);
      template.resourceCountIs("AWS::GuardDuty::MalwareProtectionPlan", 1);
      template.resourceCountIs("AWS::GuardDuty::Detector", 0);
      template.resourceCountIs("AWS::IAM::Role", 1);
      const bucketId = Object.keys(
        template.findResources("AWS::S3::Bucket", {
          Properties: { LoggingConfiguration: { LogFilePrefix: "documents/" } },
        }),
      )[0];
      const roleId = Object.keys(template.findResources("AWS::IAM::Role"))[0];
      const planId = Object.keys(
        template.findResources("AWS::GuardDuty::MalwareProtectionPlan"),
      )[0];
      const bucketArn = { "Fn::GetAtt": [bucketId, "Arn"] };
      const objectArn = (suffix: string) => ({
        "Fn::Join": ["", [bucketArn, `/${suffix}`]],
      });
      const managedRuleArn = `arn:aws:events:${config.region}:${config.account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`;
      const principal = "malware-protection-plan.guardduty.amazonaws.com";
      const statement = (
        sid: string,
        actions: string[],
        resource: unknown,
        condition?: unknown,
      ) => ({
        Sid: sid,
        Effect: "Allow",
        Action: actions.length === 1 ? actions[0] : [...actions].sort(),
        Resource: resource,
        ...(condition ? { Condition: condition } : {}),
      });
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: Match.objectEquals({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: "sts:AssumeRole",
              Principal: { Service: principal },
            },
          ],
        }),
        ManagedPolicyArns: Match.absent(),
        Policies: [
          {
            PolicyName: "MalwareProtection",
            PolicyDocument: Match.objectEquals({
              Version: "2012-10-17",
              Statement: [
                statement(
                  "AllowManagedRuleToSendS3EventsToGuardDuty",
                  [
                    "events:PutRule",
                    "events:DeleteRule",
                    "events:PutTargets",
                    "events:RemoveTargets",
                  ],
                  managedRuleArn,
                  { StringLike: { "events:ManagedBy": principal } },
                ),
                statement(
                  "AllowGuardDutyToMonitorEventBridgeManagedRule",
                  ["events:DescribeRule", "events:ListTargetsByRule"],
                  managedRuleArn,
                ),
                statement(
                  "AllowPostScanTag",
                  [
                    "s3:PutObjectTagging",
                    "s3:GetObjectTagging",
                    "s3:PutObjectVersionTagging",
                    "s3:GetObjectVersionTagging",
                  ],
                  objectArn("*"),
                ),
                statement(
                  "AllowEnableS3EventBridgeEvents",
                  ["s3:PutBucketNotification", "s3:GetBucketNotification"],
                  bucketArn,
                ),
                statement(
                  "AllowPutValidationObject",
                  ["s3:PutObject"],
                  objectArn("malware-protection-resource-validation-object"),
                ),
                statement(
                  "AllowCheckBucketOwnership",
                  ["s3:ListBucket"],
                  bucketArn,
                ),
                statement(
                  "AllowMalwareScan",
                  ["s3:GetObject", "s3:GetObjectVersion"],
                  objectArn("*"),
                ),
                statement(
                  "AllowDecryptForMalwareScan",
                  ["kms:GenerateDataKey", "kms:Decrypt"],
                  stage.storage.resolve(stage.foundation.dataKey.keyArn),
                  {
                    StringLike: {
                      "kms:ViaService": `s3.${config.region}.amazonaws.com`,
                    },
                  },
                ),
              ],
            }),
          },
        ],
      });
      template.hasResource("AWS::GuardDuty::MalwareProtectionPlan", {
        Properties: Match.objectEquals({
          Role: { "Fn::GetAtt": [roleId, "Arn"] },
          ProtectedResource: { S3Bucket: { BucketName: { Ref: bucketId } } },
          Actions: { Tagging: { Status: "ENABLED" } },
        }),
        DependsOn: Match.arrayWith([roleId]),
      });
      template.hasOutput("MalwareProtectionPlanId", {
        Value: { "Fn::GetAtt": [planId, "MalwareProtectionPlanId"] },
      });
    },
  );

  it.each(environments)(
    "database operations in %s have only database permissions",
    (name, config) => {
      const stage = new AqarakStage(testApp(), name, { config });
      const stack = stage.databaseOps;
      const resolved = (value: string): unknown => stack.resolve(value);
      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::Lambda::Function", 1);
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: config.logRetention,
      });
      const logId = Object.keys(
        template.findResources("AWS::Logs::LogGroup"),
      )[0];
      template.hasResourceProperties("AWS::Lambda::Function", {
        Runtime: "nodejs24.x",
        Architectures: ["arm64"],
        MemorySize: 512,
        Timeout: 300,
        VpcConfig: Match.absent(),
        LoggingConfig: { LogGroup: { Ref: logId } },
        Environment: {
          Variables: Match.objectEquals({
            DATABASE_CLUSTER_ARN: resolved(stage.data.cluster.clusterArn),
            DATABASE_NAME: "aqarak",
            MASTER_SECRET_ARN: resolved(stage.data.masterSecret.secretArn),
            APP_SECRET_ARN: resolved(stage.data.appSecret.secretArn),
            PIPELINE_SECRET_ARN: resolved(stage.data.pipelineSecret.secretArn),
            SCHEDULER_SECRET_ARN: resolved(
              stage.data.schedulerSecret.secretArn,
            ),
            POWERTOOLS_SERVICE_NAME: "database-ops",
            POWERTOOLS_LOG_LEVEL: config.logLevel,
          }),
        },
      });
      template.hasOutput("MigrateFunctionName", {});
      const policies = z
        .record(
          z.string(),
          z.object({
            Properties: z.object({
              PolicyDocument: z.object({
                Statement: z.array(
                  z.object({
                    Effect: z.literal("Allow"),
                    Action: z.union([z.string(), z.array(z.string())]),
                    Resource: z.unknown(),
                  }),
                ),
              }),
            }),
          }),
        )
        .parse(template.findResources("AWS::IAM::Policy"));
      const statements = Object.values(policies).flatMap(
        (policy) => policy.Properties.PolicyDocument.Statement,
      );
      const actions = (statement: (typeof statements)[number]) =>
        typeof statement.Action === "string"
          ? [statement.Action]
          : statement.Action;
      const resources = (statement: (typeof statements)[number]): unknown[] =>
        Array.isArray(statement.Resource)
          ? (statement.Resource as unknown[])
          : [statement.Resource];
      const secrets = statements.filter((statement) =>
        actions(statement).includes("secretsmanager:GetSecretValue"),
      );
      expect(secrets.flatMap(resources)).toEqual(
        expect.arrayContaining(
          [
            stage.data.masterSecret,
            stage.data.appSecret,
            stage.data.pipelineSecret,
            stage.data.schedulerSecret,
          ].map((secret) => resolved(secret.secretArn)),
        ),
      );
      expect(secrets.flatMap(resources)).toHaveLength(4);
      expect([...new Set(statements.flatMap(actions))].sort()).toEqual(
        [
          "kms:Decrypt",
          "rds-data:BatchExecuteStatement",
          "rds-data:BeginTransaction",
          "rds-data:CommitTransaction",
          "rds-data:ExecuteStatement",
          "rds-data:RollbackTransaction",
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
        ].sort(),
      );
      for (const statement of statements.filter((item) =>
        actions(item).some((action) => action.startsWith("rds-data:")),
      ))
        expect(resources(statement)).toEqual([
          resolved(stage.data.cluster.clusterArn),
        ]);
      for (const statement of statements.filter((item) =>
        actions(item).includes("kms:Decrypt"),
      ))
        expect(resources(statement)).toEqual([
          resolved(stage.foundation.dataKey.keyArn),
        ]);
      template.resourceCountIs("AWS::IAM::Role", 1);
      template.hasResourceProperties("AWS::IAM::Role", {
        ManagedPolicyArns: [
          {
            "Fn::Join": [
              "",
              [
                "arn:",
                { Ref: "AWS::Partition" },
                ":iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
              ],
            ],
          },
        ],
      });
      expect(JSON.stringify(policies)).not.toContain("s3:");
      expect(stage.foundation.dependencies).not.toContain(stack);
      expect(stage.data.dependencies).not.toContain(stack);
    },
  );

  it("runs AwsSolutions during whole-app synthesis with no finding", () => {
    const app = testApp();
    const checks = new AwsSolutionsChecks(app);
    const validation = vi.spyOn(checks, "validate");
    Validations.of(app).addPlugins(checks);
    new AqarakStage(app, "Dev", { config: devConfig });
    new AqarakStage(app, "Prod", { config: prodConfig });
    app.synth();
    const acknowledgementSchema = z.record(z.string(), z.string().min(20));
    for (const construct of app.node.findAll()) {
      for (const metadata of construct.node.metadata) {
        if (metadata.type === Validations.ACKNOWLEDGED_RULES_METADATA_KEY) {
          expect(
            Object.keys(acknowledgementSchema.parse(metadata.data)),
          ).not.toContain("AwsSolutions-APIG3");
          expect(acknowledgementSchema.safeParse(metadata.data).success).toBe(
            true,
          );
        }
      }
    }
    expect(validation).toHaveBeenCalled();
    expect(validation).toHaveReturnedWith({ success: true, violations: [] });
  });
});
