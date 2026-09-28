# @aqarak/workers

I keep the database migration handler in this workspace. Its default `migrate` action bootstraps the three allow-listed runtime roles before applying the migration ledger. Its `measure-latency` action measures application-role transactions from the function's Region.

I configure `DATABASE_CLUSTER_ARN`, `DATABASE_NAME`, `MASTER_SECRET_ARN`, `APP_SECRET_ARN`, `PIPELINE_SECRET_ARN` and `SCHEDULER_SECRET_ARN`. I load SQL files from `MIGRATIONS_DIR`, falling back to `${LAMBDA_TASK_ROOT}/migrations`. I read role secrets only during runtime bootstrap and keep credentials and derived verifiers out of logs and responses.

I run `pnpm --filter @aqarak/workers lint`, `pnpm --filter @aqarak/workers typecheck`, `pnpm --filter @aqarak/workers test` and `pnpm --filter @aqarak/workers build` from the repository root. I validate handler ordering with synthetic dependencies; deployment and live role bootstrap are separate checks.
