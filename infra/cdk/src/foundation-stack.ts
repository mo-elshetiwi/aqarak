import {
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import { Key } from "aws-cdk-lib/aws-kms";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config";

export interface FoundationStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/** Retains the shared encryption key and access log destination. */
export class FoundationStack extends Stack {
  readonly dataKey: Key;
  readonly accessLogsBucket: Bucket;
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);
    this.dataKey = new Key(this, "DataKey", {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.accessLogsBucket = new Bucket(this, "AccessLogsBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [
        { expiration: Duration.days(props.config.accessLogsExpiryDays) },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    Validations.of(this.accessLogsBucket).acknowledge({
      id: "AwsSolutions-S1",
      reason:
        "This dedicated destination stores server access logs without recursive access logging.",
    });
  }
}
