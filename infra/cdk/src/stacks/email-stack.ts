import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { EventBus } from "aws-cdk-lib/aws-events";
import {
  ConfigurationSet,
  ConfigurationSetTlsPolicy,
  EmailSendingEvent,
  EventDestination,
  SuppressionReasons,
} from "aws-cdk-lib/aws-ses";
import type { Construct } from "constructs";

export class EmailStack extends Stack {
  readonly configurationSet: ConfigurationSet;
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);
    this.configurationSet = new ConfigurationSet(this, "ConfigurationSet", {
      reputationMetrics: true,
      sendingEnabled: true,
      suppressionReasons: SuppressionReasons.BOUNCES_AND_COMPLAINTS,
      tlsPolicy: ConfigurationSetTlsPolicy.REQUIRE,
    });
    this.configurationSet.addEventDestination("EmailEvents", {
      destination: EventDestination.eventBus(
        EventBus.fromEventBusName(this, "DefaultEventBus", "default"),
      ),
      events: [
        EmailSendingEvent.SEND,
        EmailSendingEvent.DELIVERY,
        EmailSendingEvent.BOUNCE,
        EmailSendingEvent.COMPLAINT,
        EmailSendingEvent.REJECT,
        EmailSendingEvent.RENDERING_FAILURE,
        EmailSendingEvent.DELIVERY_DELAY,
      ],
    });
    new CfnOutput(this, "EmailConfigurationSetName", {
      value: this.configurationSet.configurationSetName,
    });
  }
}
