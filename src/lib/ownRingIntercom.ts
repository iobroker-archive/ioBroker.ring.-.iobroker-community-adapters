import {
  IntercomHandsetAudioData,
  RingIntercom,
} from "ring-client-api";
import util from "util";

import { OwnRingDevice } from "./ownRingDevice";
import { OwnRingLocation } from "./ownRingLocation";
import { RingAdapter } from "../main";
import { RingApiClient } from "./ringApiClient";
import { EventBlocker } from "./services/event-blocker";
import {
  CHANNEL_NAME_EVENTS,
  CHANNEL_NAME_INFO,
  COMMON_DEBUG_REQUEST,
  COMMON_EVENTS_INTERCOM_DING,
  COMMON_INFO_DESCRIPTION,
  COMMON_INFO_ID,
  COMMON_INFO_KIND,
  COMMON_INFO_BATTERY_PERCENTAGE,
  COMMON_INFO_BATTERY_PERCENTAGE_CATEGORY,
  COMMON_INFO_FIRMWARE,
  COMMON_INTERCOM_UNLOCK_REQUEST,
  STATE_ID_DEBUG_REQUEST,
  STATE_ID_INTERCOM_UNLOCK,
} from "./constants";

export class OwnRingIntercom extends OwnRingDevice {
  private readonly infoChannelId: string;
  private readonly eventsChannelId: string;
  private _ringIntercom: RingIntercom;
  private _dingEventBlocker: EventBlocker;

  public constructor(
    ringDevice: RingIntercom,
    location: OwnRingLocation,
    adapter: RingAdapter,
    apiClient: RingApiClient
  ) {
    super(
      location,
      adapter,
      apiClient,
      OwnRingDevice.evaluateKind(
        ringDevice.deviceType as string,
        adapter,
        ringDevice
      ),
      `${ringDevice.id}`,
      ringDevice.data.description
    );
    // Initialize event blocker to manage ding events
    this._dingEventBlocker = new EventBlocker(
      this._adapter.config.ignore_events_Doorbell,
      this._adapter.config.keep_ignoring_if_retriggered
    );
    this._ringIntercom = ringDevice;
    this.infoChannelId = `${this.fullId}.${CHANNEL_NAME_INFO}`;
    this.eventsChannelId = `${this.fullId}.${CHANNEL_NAME_EVENTS}`;

    // Create the device object tree in ioBroker
    this.recreateDeviceObjectTree();
    // Subscribe to events from the intercom
    this.subscribeToEvents();

    // Subscribe to data changes from the intercom
    this._ringIntercom.onData.subscribe({
      next: (data: IntercomHandsetAudioData): void => {
        this.update(data);
      },
      error: (err: Error): void => {
        this.catcher(`Data Observer received error`, err);
      },
    });

    // Subscribe to battery level changes
    this._ringIntercom.onBatteryLevel.subscribe({
      next: (): void => {
        this.updateBatteryInfo();
      },
      error: (err: Error): void => {
        this.catcher(`Battery Level Observer received error`, err);
      },
    });
  }

  public processUserInput(
    channelID: string,
    stateID: string,
    state: ioBroker.State
  ): void {
    switch (channelID) {
      case "":
        const targetBoolVal: boolean = state.val as boolean;
        switch (stateID) {
          case STATE_ID_DEBUG_REQUEST:
            if (targetBoolVal) {
              this.info(
                `Device Debug Data for ${this.shortId}: ${util.inspect(
                  this._ringIntercom,
                  false,
                  1
                )}`
              );
              this._adapter.upsertState(
                `${this.fullId}.${STATE_ID_DEBUG_REQUEST}`,
                COMMON_DEBUG_REQUEST,
                false
              );
            }
            break;
          case STATE_ID_INTERCOM_UNLOCK:
            if (targetBoolVal) {
              this.info(`Unlock door request for ${this.shortId}.`);
              this._ringIntercom.unlock().catch((reason: any): void => {
                this.catcher("Couldn't unlock door.", reason);
              });
              this._adapter.upsertState(
                `${this.fullId}.${STATE_ID_INTERCOM_UNLOCK}`,
                COMMON_INTERCOM_UNLOCK_REQUEST,
                false
              );
            }
            break;
          default:
            this.error(
              `Unknown State/Switch with channel "${channelID}" and state "${stateID}"`
            );
        }
        return;
      default:
        this.error(
          `Unknown State/Switch with channel "${channelID}" and state "${stateID}"`
        );
    }
  }

  public updateByDevice(intercom: RingIntercom): void {
    this._ringIntercom = intercom;
    this.subscribeToEvents();
    this.update(intercom.data);
  }

  protected async recreateDeviceObjectTree(): Promise<void> {
    this.silly(`Recreate DeviceObjectTree`);

    // Ersetzen von createDevice durch setObjectNotExistsAsync
    await this._adapter.setObjectNotExistsAsync(this.fullId, {
      type: "device",
      common: {
        name: `Device ${this.shortId} ("${this._ringIntercom.data.description}")`,
      },
      native: {},
    });

    // Ersetzen von createChannel durch setObjectNotExistsAsync
    await this._adapter.setObjectNotExistsAsync(`${this.fullId}.${CHANNEL_NAME_INFO}`, {
      type: "channel",
      common: {
        name: `Info ${this.shortId}`,
      },
      native: {},
    });
    await this._adapter.setObjectNotExistsAsync(`${this.fullId}.${CHANNEL_NAME_EVENTS}`, {
      type: "channel",
      common: {
        name: `Events`,
      },
      native: {},
    });

    // Create states in the Info channel
    await this._adapter.upsertState(
      `${this.infoChannelId}.id`,
      COMMON_INFO_ID,
      this._ringIntercom.data.device_id
    );
    await this._adapter.upsertState(
      `${this.infoChannelId}.kind`,
      COMMON_INFO_KIND,
      this._ringIntercom.data.kind as string
    );
    await this._adapter.upsertState(
      `${this.infoChannelId}.description`,
      COMMON_INFO_DESCRIPTION,
      this._ringIntercom.data.description
    );
    // Firmware version might be available under 'firmware_version'
    await this._adapter.upsertState(
      `${this.infoChannelId}.firmware`,
      COMMON_INFO_FIRMWARE,
      this._ringIntercom.data.firmware_version
    );

    // Create battery data points
    await this._adapter.upsertState(
      `${this.infoChannelId}.battery_percentage`,
      COMMON_INFO_BATTERY_PERCENTAGE,
      null
    );
    await this._adapter.upsertState(
      `${this.infoChannelId}.battery_percentage_category`,
      COMMON_INFO_BATTERY_PERCENTAGE_CATEGORY,
      null
    );

    // Create states in the Events channel
    await this._adapter.upsertState(
      `${this.eventsChannelId}.ding`,
      COMMON_EVENTS_INTERCOM_DING,
      false
    );

    // Create states for debug and unlock requests
    await this._adapter.upsertState(
      `${this.fullId}.${STATE_ID_DEBUG_REQUEST}`,
      COMMON_DEBUG_REQUEST,
      false,
      true,
      true
    );
    await this._adapter.upsertState(
      `${this.fullId}.${STATE_ID_INTERCOM_UNLOCK}`,
      COMMON_INTERCOM_UNLOCK_REQUEST,
      false,
      true,
      true
    );
  }

  private update(data: IntercomHandsetAudioData): void {
    this.debug(`Received Update`);
    this.updateDeviceInfoObject(data);
    this.updateBatteryInfo();
  }

  private updateDeviceInfoObject(data: IntercomHandsetAudioData): void {
    this._adapter.upsertState(
      `${this.infoChannelId}.id`,
      COMMON_INFO_ID,
      data.device_id
    );
    this._adapter.upsertState(
      `${this.infoChannelId}.kind`,
      COMMON_INFO_KIND,
      data.kind as string
    );
    this._adapter.upsertState(
      `${this.infoChannelId}.description`,
      COMMON_INFO_DESCRIPTION,
      data.description
    );
    // Update firmware version if available
    this._adapter.upsertState(
      `${this.infoChannelId}.firmware`,
      COMMON_INFO_FIRMWARE,
      data.firmware_version
    );
  }

  private updateBatteryInfo(): void {
    const batteryLevel: number | null = this._ringIntercom.batteryLevel;
    let batteryPercentage: number = -1;
    if (batteryLevel !== null && batteryLevel !== undefined) {
      batteryPercentage = batteryLevel;
    }

    // Update battery percentage state
    this._adapter.upsertState(
      `${this.infoChannelId}.battery_percentage`,
      COMMON_INFO_BATTERY_PERCENTAGE,
      batteryPercentage
    );

    // Determine battery category based on percentage
    let batteryCategory: string = "Unknown";
    if (batteryPercentage >= 75) {
      batteryCategory = "Full";
    } else if (batteryPercentage >= 50) {
      batteryCategory = "High";
    } else if (batteryPercentage >= 25) {
      batteryCategory = "Medium";
    } else if (batteryPercentage >= 0) {
      batteryCategory = "Low";
    }

    // Update battery category state
    this._adapter.upsertState(
      `${this.infoChannelId}.battery_percentage_category`,
      COMMON_INFO_BATTERY_PERCENTAGE_CATEGORY,
      batteryCategory
    );
  }

  private async subscribeToEvents(): Promise<void> {
    this.silly(`Start device subscriptions`);
    await this._ringIntercom
      .subscribeToDingEvents()
      .catch((r: any): void => {
        this.catcher(
          `Failed subscribing to Ding Events for ${this._ringIntercom.name}`,
          r
        );
      });
    this._ringIntercom.onDing.subscribe({
      next: (): void => {
        this.onDing();
      },
      error: (err: Error): void => {
        this.catcher(`Ding Observer received error`, err);
      },
    });
  }

  private onDing(): void {
    if (this._dingEventBlocker.checkBlock()) {
      this.debug(`Ignore Ding event...`);
      return;
    }
    this.debug(`Received Ding Event`);
    this._adapter.upsertState(
      `${this.eventsChannelId}.ding`,
      COMMON_EVENTS_INTERCOM_DING,
      true
    );
    setTimeout((): void => {
      this._adapter.upsertState(
        `${this.eventsChannelId}.ding`,
        COMMON_EVENTS_INTERCOM_DING,
        false
      );
    }, 1000);
  }
}
