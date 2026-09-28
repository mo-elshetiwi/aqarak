import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import {
  AccountRecovery,
  FeaturePlan,
  Mfa,
  UserPool,
  UserPoolClient,
  UserPoolEmail,
  VerificationEmailStyle,
} from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";

export interface IdentityStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}
export class IdentityStack extends Stack {
  readonly userPool: UserPool;
  readonly webClient: UserPoolClient;
  readonly mobileClient: UserPoolClient;
  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);
    const { config } = props;
    this.userPool = new UserPool(this, "UserPool", {
      featurePlan: FeaturePlan.ESSENTIALS,
      signInAliases: { email: true },
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: config.deletionProtection,
      email:
        config.email.mode === "ses"
          ? UserPoolEmail.withSES({
              fromEmail: config.email.fromEmail,
              sesVerifiedDomain: config.email.verifiedDomain,
              sesRegion: config.region,
            })
          : UserPoolEmail.withCognito(),
      userVerification: {
        emailSubject: "Aqarak email verification | تأكيد بريد عقارك",
        emailBody:
          "Your Aqarak verification code is {####}.<br>رمز تأكيد بريدك في عقارك هو {####}.",
        emailStyle: VerificationEmailStyle.CODE,
      },
      userInvitation: {
        emailSubject: "Welcome to Aqarak | مرحباً بك في عقارك",
        emailBody:
          "Your Aqarak username is {username} and your temporary password is {####}. Please change it when signing in.<br>اسم المستخدم في عقارك هو {username} وكلمة المرور المؤقتة هي {####}. يرجى تغييرها عند تسجيل الدخول.",
      },
    });
    const client = (constructId: string, refreshDays: number): UserPoolClient =>
      new UserPoolClient(this, constructId, {
        userPool: this.userPool,
        generateSecret: false,
        authFlows: { adminUserPassword: true },
        disableOAuth: true,
        preventUserExistenceErrors: true,
        enableTokenRevocation: true,
        accessTokenValidity: Duration.minutes(60),
        idTokenValidity: Duration.minutes(60),
        refreshTokenValidity: Duration.days(refreshDays),
      });
    this.webClient = client("WebClient", 7);
    this.mobileClient = client("MobileClient", 30);
    Validations.of(this.userPool).acknowledge({
      id: "AwsSolutions-COG2",
      reason:
        "The pool provides optional TOTP MFA; the application will enforce MFA according to company roles.",
    });
    Validations.of(this.userPool).acknowledge({
      id: "AwsSolutions-COG3",
      reason:
        "The Essentials feature plan is configured; advanced threat protection requires the Plus plan.",
    });
    Validations.of(this.userPool).acknowledge({
      id: "AwsSolutions-COG8",
      reason:
        "The agreed Essentials feature plan is configured; the Plus tier and its advanced threat protection are outside this environment contract.",
    });
    for (const [name, value] of Object.entries({
      UserPoolId: this.userPool.userPoolId,
      UserPoolArn: this.userPool.userPoolArn,
      WebClientId: this.webClient.userPoolClientId,
      MobileClientId: this.mobileClient.userPoolClientId,
    }))
      new CfnOutput(this, name, { value });
  }
}
