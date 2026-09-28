import { getConfig } from "../../../config";
export interface EstateConfig {
  clusterArn: string | undefined;
  secretArn: string | undefined;
  database: string | undefined;
  bucket: string | undefined;
  keyPrefix: string;
  region: string | undefined;
  localIdentitySecret: string | undefined;
}
let cached: EstateConfig | undefined;
export function estateConfig(): EstateConfig {
  cached ??= {
    clusterArn: getConfig().DATABASE_CLUSTER_ARN,
    secretArn: getConfig().APP_SECRET_ARN,
    database: getConfig().DATABASE_NAME,
    bucket: getConfig().DOCUMENTS_BUCKET_NAME,
    keyPrefix: getConfig().DOCUMENT_KEY_PREFIX,
    region: getConfig().AWS_REGION,
    localIdentitySecret: getConfig().AQARAK_LOCAL_IDENTITY_SECRET,
  };
  return cached;
}
