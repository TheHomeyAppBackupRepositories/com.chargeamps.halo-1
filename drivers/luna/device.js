"use strict";

const { Device } = require("homey");
const axios = require("axios");

/******************************************************************************************************
 * Represents a LUNA Device that extends the base Device class.
 * 
 * This class is responsible for initializing the LUNA device, managing its capabilities,
 * handling API interactions with ChargeAmps, and logging messages based on the debug level.
 * 
 * @class
 * @extends Device
 * 
 * @property {string|null} chargeAmpsToken - The authentication token for ChargeAmps API.
 * @property {string|null} chargeAmpsRefreshToken - The refresh token for ChargeAmps API.
 * @property {string} chargeAmpsId - The specific device ID passed from the pairing process.
 * @property {number|null} lunaCurrent - The current limit for the LUNA device.
 * @property {string|null} lunaChargerStatus - The status of the LUNA charger.
 * @property {boolean} isGettingData - Flag indicating if data is being retrieved.
 * @property {string|null} statusLEDring - The status of the LED ring.
 * @property {boolean|null} statusRFID - The status of the RFID.
 * @property {boolean|null} statusCableLock - The status of the cable lock.
 * @property {number|null} nowConsumptionKwh - The current consumption in kWh.
 * @property {number|null} chargingConsumptionKwh - The consumption during charging in kWh.
 * @property {number|null} meterChargingKWH - The meter reading for charging in kWh.
 * @property {number|null} previousConsumptionKwh - The previous consumption in kWh.
 * @property {string} debugLevel - The debug level for logging messages.
 * 
 * @method onInit - Initializes the LUNA Device.
 * @method logMessage - Logs messages based on the specified debug level.
 * @method basicPreparation - Performs basic preparation for the device.
 * @method onOnOffCapabilityChange - Handles the change in the On/Off capability of the charger.
 * @method onLunaLEDringControl - Controls the LED ring status for the LUNA device.
 * @method onlunaRFIDButton - Handles the RFID button press event for the LUNA charger.
 * @method onlunaCableLockButton - Handles the cable lock button action for the LUNA charger.
 * @method onSettings - Handles the event when settings are changed.
 * @method api - Creates an Axios instance configured for the ChargeAmps API.
 * @method loginCA - Logs in to the ChargeAmps service using the provided credentials and security key.
 * @method renewToken - Asynchronously renews the ChargeAmps authentication token.
 * @method renewTokenLoop - Periodically renews the token by calling the renewToken method.
 * @method setChargerSettings - Sets the charger settings for a ChargeAmps device.
 * @method setLightAndDimmer - Sets the light and dimmer value for the LED ring.
 * @method getCAdataLoop - Continuously fetches Charge Amps data in a loop with dynamic timeout intervals.
 ******************************************************************************************************/

class LUNADevice extends Device {

  /*****************************************************************************************
   * Initializes the LUNA Device.
   * 
   * This method performs the following actions:
   * - Logs the initialization message.
   * - Defines and initializes various instance variables.
   * - Logs the retrieved ChargeAmps device ID.
   * - Calls a module to check capabilities, set capability listeners, and define flow cards.
   * - Attempts to log in to the ChargeAmps API using credentials from Homey settings.
   * - Initiates the data retrieval loop from ChargeAmps.
   * - Sets a timeout to initiate the token renewal loop after 30 minutes.
   * 
   * @async
   * @throws {Error} If login to ChargeAmps API fails.
   *****************************************************************************************/
  async onInit() {
    this.logMessage('normal', "LUNA Device has been initialized");

    /* Define variables */
    this.chargeAmpsToken = null;
    this.chargeAmpsRefreshToken = null;
    this.chargeAmpsId = this.getData().id; // Retrieve the specific device ID passed from the pairing process
    this.lunaCurrent = null;
    this.lunaChargerStatus = null;
    this.isGettingData = false;
    this.statusLEDring = null;
    this.statusRFID = null;
    this.statusCableLock = null;
    this.nowConsumptionKwh = null;
    this.chargingConsumptionKwh = null;
    this.meterChargingKWH = null;
    this.previousConsumptionKwh = null;
    this.debugLevel = this.getSetting('debugLevel') || 'normal';

    // Logga chargeAmpsId för felsökning
    this.logMessage('normal', `chargeAmpsId retrieved: ${this.chargeAmpsId}`);

    // Call module to Check Cabapilities, set Capablility Listeners and define Flow Cards
    await this.basicPreparation();

    // Login to ChargeAmps API
    try {
      await this.loginCA(this.homey.settings.get("email"), this.homey.settings.get("password"), this.homey.settings.get("APIkey"));
    } catch (error) {
      this.logMessage('error', "Login failed:", error);
      throw new Error("Failed to log in to ChargeAmps API");
    }

    // Initial collection of basic data from ChargeAmps
    await this.getHourlyData();

    // Initiate the get ChargeAmps Data Loop
    this.getCAdataLoop();

    // Initiate Renew Token Loop (first run after 30min)
    setTimeout(() => this.renewTokenLoop(), 1000 * 60 * 30); // 30 minutes delay for the first execution
  }

  /***********************************************************************************************************************************
   * Logs messages based on the specified debug level.
   *
   * @param {string} level - The level of the message to log. Can be 'off', 'normal', 'trace', 'full', or 'error'.
   * @param {...any} messages - The messages to log.
   **********************************************************************************************************************************/
  logMessage(level, ...messages) {
    const debugLevels = ['off', 'normal', 'trace', 'full'];

    const currentLevel = this.debugLevel || 'normal';
    const currentLevelIndex = debugLevels.indexOf(currentLevel);
    const levelIndex = debugLevels.indexOf(level);

    // Always log error messages, regardless of the debug level
    if (level === 'error') {
      this.log('[ERROR]', ...messages);
      return;
    }

    // Log based on the selected debug level
    if (levelIndex <= currentLevelIndex && currentLevelIndex > 0) {
      this.log(...messages);
    }
  }

  /****************************************************************************************
   * Performs basic preparation for the device by:
   * 1. Removing old capabilities if they exist.
   * 2. Adding new capabilities if they are not already present.
   * 3. Registering capability listeners for various capabilities.
   * 4. Registering flow cards and their respective listeners for actions and conditions.
   * 
   * @async
   * @function basicPreparation
   * @returns {Promise<void>} A promise that resolves when the preparation is complete.
   ***************************************************************************************/
  async basicPreparation() {

    // Check and remove old capabilities (measure_power, meter_power)
    const oldCapabilities = ['measure_power', 'meter_power', 'lunaChargerStatus', 'lunaCarConnected', 'lunaCurrentLimit', 'lunaLastCharged', 'lunaNowCharged', 'lunaFW', 'lunaVersion', 'lunaLEDringStatus', 'lunaRFIDStatus', 'lunaCableLockStatus'];

    for (const capability of oldCapabilities) {
      if (this.hasCapability(capability)) {
        this.logMessage('trace', `Removing old capability: ${capability}`);
        await this.removeCapability(capability);
      }
    }

    // Check if the capabilities are defined and if not add them
    const capabilities = [
      "measure_luna",
      "meter_luna",
      "onoff",
      "lunaRFIDButton",
      "lunaCableLockButton",
      "lunaLEDringButton",
      "lunaChargerStatus",
      "lunaCarConnected",
      "lunaCurrentLimit",
      "lunaLastCharged",
      "lunaNowCharged",
      "lunaFW",
      "lunaVersion",
      "lunaLEDringStatus",
      "lunaRFIDStatus",
      "lunaCableLockStatus",
    ];

    for (const capability of capabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

    // Register capability listeners
    this.registerCapabilityListener("onoff", this.onOnOffCapabilityChange.bind(this));
    this.registerCapabilityListener("lunaLEDringControl", this.onLunaLEDringControl.bind(this));
    this.registerCapabilityListener('lunaRFIDButton', this.onlunaRFIDButton.bind(this));
    this.registerCapabilityListener('lunaCableLockButton', this.onlunaCableLockButton.bind(this));

    // Register flow cards
    const cardActionCurrent = this.homey.flow.getActionCard("luna-changecurrent");
    const cardActionLEDring = this.homey.flow.getActionCard("luna-change-led-ring");
    const cardActionRFIDOn = this.homey.flow.getActionCard('luna-turn-on-RFID');
    const cardActionRFIDOff = this.homey.flow.getActionCard('luna-turn-off-RFID');
    const cardActionCableLockOn = this.homey.flow.getActionCard('luna-turn-on-CableLock');
    const cardActionCableLockOff = this.homey.flow.getActionCard('luna-turn-off-CableLock');
    const cardConditionCarConnected = this.homey.flow.getConditionCard("luna-carIsConnected");
    const cardConditionCarIsCharging = this.homey.flow.getConditionCard("luna-carIsCharging");
    const cardConditionRFID = this.homey.flow.getConditionCard('luna-RFIDStatus');
    const cardConditionCableLock = this.homey.flow.getConditionCard('luna-CableLockStatus');

    // Register flow card listeners
    cardActionCurrent.registerRunListener(async (args) => {
      const { Current } = args;
      this.lunaCurrent = Current;

      this.logMessage('normal', "Current limit action triggered. Current value:", Current);

      await Promise.all([
        this.setSettings({ settingsCurrentLimit: Current }),
        this.setChargerSettings(Current, this.statusRFID, this.lunaChargerStatus, this.statusCableLock),
        this.setCapabilityValue("lunaCurrentLimit", Current),
      ]);

      this.logMessage('trace', `Set lunaCurrentLimit capability to: ${Current}`);
    });

    cardActionLEDring.registerRunListener(async (args) => {
      const { LEDring } = args;
      this.statusLEDring = LEDring;

      this.logMessage('normal', "LEDring action triggered. LEDring value:", LEDring);

      await Promise.all([
        this.setLightAndDimmer(LEDring),
        this.setCapabilityValue("lunaLEDringStatus", LEDring),
      ]);

      this.logMessage('trace', `Set lunaLEDringStatus capability to: ${LEDring}`);
    });

    cardActionRFIDOn.registerRunListener(async () => {
      const cardTriggerRFIDOn = this.homey.flow.getDeviceTriggerCard('luna-RFID-switched-on');
      cardTriggerRFIDOn.trigger(this, {}, {}).catch(this.error);
      this.statusRFID = true;

      this.logMessage('normal', "RFID On action triggered.");

      await Promise.all([
        this.setChargerSettings(this.lunaCurrent, true, this.lunaChargerStatus, this.statusCableLock),
        this.setCapabilityValue('lunaRFIDStatus', 'On'),
        this.setCapabilityValue('lunaRFIDButton', true),
      ]);

      this.logMessage('trace', "Set lunaRFIDStatus capability to: On");
      this.logMessage('trace', "Set lunaRFIDButton capability to: true");
    });

    cardActionRFIDOff.registerRunListener(async () => {
      const cardTriggerRFIDOff = this.homey.flow.getDeviceTriggerCard('luna-RFID-switched-off');
      cardTriggerRFIDOff.trigger(this, {}, {}).catch(this.error);
      this.statusRFID = false;

      this.logMessage('normal', "RFID Off action triggered.");

      await Promise.all([
        this.setChargerSettings(this.lunaCurrent, false, this.lunaChargerStatus, this.statusCableLock),
        this.setCapabilityValue('lunaRFIDStatus', 'Off'),
        this.setCapabilityValue('lunaRFIDButton', false),
      ]);

      this.logMessage('trace', "Set lunaRFIDStatus capability to: Off");
      this.logMessage('trace', "Set lunaRFIDButton capability to: false");
    });

    cardActionCableLockOn.registerRunListener(async () => {
      const cardTriggerCableLockOn = this.homey.flow.getDeviceTriggerCard('luna-CableLock-switched-on');
      cardTriggerCableLockOn.trigger(this, {}, {}).catch(this.error);
      this.statusCableLock = true;

      this.logMessage('normal', "Cable Lock On action triggered.");

      await Promise.all([
        this.setChargerSettings(this.lunaCurrent, this.statusRFID, this.lunaChargerStatus, true),
        this.setCapabilityValue('lunaCableLockStatus', 'On'),
        this.setCapabilityValue('lunaCableLockButton', true),
      ]);

      this.logMessage('trace', "Set lunaCableLockStatus capability to: On");
      this.logMessage('trace', "Set lunaCableLockButton capability to: true");
    });

    cardActionCableLockOff.registerRunListener(async () => {
      const cardTriggerCableLockOff = this.homey.flow.getDeviceTriggerCard('luna-CableLock-switched-off');
      cardTriggerCableLockOff.trigger(this, {}, {}).catch(this.error);
      this.statusCableLock = false;

      this.logMessage('normal', "Cable Lock Off action triggered.");

      await Promise.all([
        this.setChargerSettings(this.lunaCurrent, this.statusRFID, this.lunaChargerStatus, false),
        this.setCapabilityValue('lunaCableLockStatus', 'Off'),
        this.setCapabilityValue('lunaCableLockButton', false),
      ]);

      this.logMessage('trace', "Set lunaCableLockStatus capability to: Off");
      this.logMessage('trace', "Set lunaCableLockButton capability to: false");
    });

    cardConditionCarConnected.registerRunListener(() => this.getCapabilityValue("lunaCarConnected") === "Connected");

    cardConditionCarIsCharging.registerRunListener(() => this.getCapabilityValue("lunaCarConnected") === "Charging");

    cardConditionRFID.registerRunListener(() => this.getCapabilityValue('lunaRFIDStatus') === 'On');

    cardConditionCableLock.registerRunListener(() => this.getCapabilityValue('lunaCableLockStatus') === 'On');
  }

  // ***********************************
  // MODULES TO HANDLE TOGGLE & BUTTONS
  // ***********************************

  /****************************************************************************************
   * Handles the change in the On/Off capability of the charger.
   *
   * @param {boolean} value - The new value of the On/Off capability. True for "On", false for "Off".
   * @returns {Promise<void>} A promise that resolves when the operation is complete.
   ***************************************************************************************/
  async onOnOffCapabilityChange(value) {
    const mode = value ? 1 : 0;
    const status = value ? "On" : "Off";
    this.logMessage('normal', `Toggling charger: mode = ${mode}, status = ${status}`);

    await Promise.all([
      this.setChargerSettings(this.lunaCurrent, this.statusRFID, mode, this.statusCableLock),
      this.setCapabilityValue("lunaChargerStatus", status),
    ]);

    this.logMessage('trace', `Set lunaChargerStatus capability to: ${status}`);
    this.lunaChargerStatus = value; // Update the internal variable
    this.logMessage('trace', `Updated internal variable lunaChargerStatus to: ${this.lunaChargerStatus}`);
  }

  /****************************************************************************************
   * Controls the LED ring status for the Luna device.
   *
   * @async
   * @param {boolean} value - The desired status of the LED ring.
   * @returns {Promise<void>} A promise that resolves when the LED ring status has been set.
   ***************************************************************************************/
  async onLunaLEDringControl(value) {
    this.logMessage('normal', `LED Ring Status set to: ${value}`);

    await Promise.all([
      this.setLightAndDimmer(value),
      this.setCapabilityValue("lunaLEDringStatus", value),
    ]);

    this.logMessage('trace', `Set lunaLEDringStatus capability to: ${value}`);
    this.statusLEDring = value;  // Update the internal variable
    this.logMessage('trace', `Updated internal variable statusLEDring to: ${this.statusLEDring}`);
  }

  /****************************************************************************************
   * Handles the RFID button press event for the Luna charger.
   *
   * Logs the event, updates charger settings, and sets the RFID status capability.
   *
   * @param {boolean} value - The value indicating the RFID button state (true for pressed, false for not pressed).
   * @returns {Promise<void>} A promise that resolves when the operation is complete.
   ***************************************************************************************/
  async onlunaRFIDButton(value) {
    this.logMessage('normal', `RFIDButton called with value: ${value}`);

    await Promise.all([
      this.setChargerSettings(this.lunaCurrent, value, this.lunaChargerStatus, this.statusCableLock),
      this.setCapabilityValue('lunaRFIDStatus', value ? 'On' : 'Off'),
    ]);

    this.logMessage('trace', `Set lunaRFIDStatus capability to: ${value ? 'On' : 'Off'}`);
    this.statusRFID = value;  // Update the internal variable
    this.logMessage('trace', `Updated internal variable statusRFID to: ${this.statusRFID}`);
  }

  /****************************************************************************************
   * Handles the cable lock button action for the Luna charger.
   *
   * @param {boolean} value - The value indicating whether the cable lock is engaged (true) or disengaged (false).
   * @returns {Promise<void>} A promise that resolves when the operation is complete.
   ***************************************************************************************/
  async onlunaCableLockButton(value) {
    this.logMessage('normal', `CableLockButton called with value: ${value}`);

    await Promise.all([
      this.setChargerSettings(this.lunaCurrent, this.statusRFID, this.lunaChargerStatus, value),
      this.setCapabilityValue('lunaCableLockStatus', value ? 'On' : 'Off'),
    ]);

    this.logMessage('trace', `Set lunaCableLockStatus capability to: ${value ? 'On' : 'Off'}`);
    this.statusCableLock = value;  // Update the internal variable
    this.logMessage('trace', `Updated internal variable statusCableLock to: ${this.statusCableLock}`);
  }

  /****************************************************************************************
   * Handles the event when settings are changed.
   *
   * @async
   * @param {Object} param0 - The settings object.
   * @param {Object} param0.newSettings - The new settings.
   * @param {number} param0.newSettings.debugLevel - The new debug level.
   * @param {number} param0.newSettings.settingsCurrentLimit - The new current limit for luna.
   * @returns {Promise<void>} - A promise that resolves when the settings have been updated.
   ***************************************************************************************/
  async onSettings({ newSettings }) {
    this.logMessage('normal', "Settings were changed");

    // update the debug level if it has changed
    if (newSettings.debugLevel) {
      this.debugLevel = newSettings.debugLevel;
      this.logMessage('normal', `Debug level updated to: ${this.debugLevel}`);
    }

    // handle the current limit setting
    this.lunaCurrent = newSettings.settingsCurrentLimit;
    this.logMessage('trace', `lunaCurrent updated to: ${this.lunaCurrent}`);

    await Promise.all([
      this.setChargerSettings(this.lunaCurrent, this.statusRFID, this.lunaChargerStatus, this.statusCableLock),
      this.setCapabilityValue("lunaCurrentLimit", this.lunaCurrent),
    ]);

    this.logMessage('trace', 'Charger settings and lunaCurrentLimit capability updated.');
  }

  /****************************************************************************************
   * Creates an Axios instance configured for the ChargeAmps API.
   *
   * @returns {AxiosInstance} An Axios instance with predefined configuration.
   ***************************************************************************************/
  api() {
    return axios.create({
      baseURL: "https://eapi.charge.space/api/v5",
      timeout: 25000,
      headers: {
        "Content-Type": "application/json",
        'accept': '*/*',
      },
    });
  }

  // *************************************************************************
  // MODULES TO LOGIN AND RENEW THE API TOKEN AND GET THE OWNED CHARGEPOINTID
  // *************************************************************************

  /****************************************************************************************
   * Logs in to the ChargeAmps service using the provided credentials and security key.
   *
   * @param {string} usr - The email address of the user.
   * @param {string} pwd - The password of the user.
   * @param {string} securityKey - The security key for the API.
   * @returns {Promise<string>} A promise that resolves to a string indicating the login status.
   * @throws {Error} Throws an error if the login process fails.
   ***************************************************************************************/
  async loginCA(usr, pwd, securityKey) {
    try {
      this.logMessage('normal', "ChargeAmps login has been initialized");
      const response = await this.api().post('/auth/login', {
        email: usr,
        password: pwd,
      }, {
        headers: {
          apiKey: securityKey,
        },
        timeout: 90000,
      });
      this.chargeAmpsToken = response.data.token;
      this.chargeAmpsRefreshToken = response.data.refreshToken;
      this.logMessage('trace', "Token = ", this.chargeAmpsToken);
      this.logMessage('trace', "RefreshToken = ", this.chargeAmpsRefreshToken);
      return "Login Completed";
    } catch (error) {
      this.logMessage('error', "An error occurred during the login process:", error.message);
      throw error;
    }
  }

  /****************************************************************************************
   * Asynchronously renews the ChargeAmps authentication token.
   * 
   * This method sends a POST request to the ChargeAmps API to refresh the authentication token
   * using the current token and refresh token. If successful, it updates the instance's token
   * and refresh token with the new values received from the API response.
   * 
   * @async
   * @function renewToken
   * @returns {Promise<void>} Resolves when the token has been successfully renewed.
   * @throws Will log an error message if the token renewal fails.
   ***************************************************************************************/
  async renewToken() {
    try {
      this.logMessage('normal', "ChargeAmps renewToken has been initialized");
      const response = await this.api().post('/auth/refreshtoken', {
        token: this.chargeAmpsToken,
        refreshToken: this.chargeAmpsRefreshToken,
      }, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 120000,
      });
      this.chargeAmpsToken = response.data.token;
      this.chargeAmpsRefreshToken = response.data.refreshToken;
      this.logMessage('trace', "Token = ", this.chargeAmpsToken);
      this.logMessage('trace', "RefreshToken = ", this.chargeAmpsRefreshToken);
    } catch (error) {
      this.logMessage('error', "Error:", error);
    }
  }

  /****************************************************************************************
   * Periodically renews the token by calling the renewToken method.
   * If an error occurs during the token renewal, it logs the error message.
   * The loop runs every 59 minutes.
   *
   * @async
   * @function renewTokenLoop
   * @returns {Promise<void>} No return value.
   ***************************************************************************************/
  async renewTokenLoop() {
    try {
      await this.renewToken();
      //Get hourly data from ChargeAmps
      await this.getHourlyData();
    } catch (error) {
      this.logMessage('error', "Error during renewToken execution:", error);
    }
    setTimeout(() => this.renewTokenLoop(), 1000 * 60 * 59);
  }

  // **************************************************
  // MODULES TO CHANGE SETTINGS IN THE CHARGE AMPS API
  // **************************************************

  /****************************************************************************************
   * Sets the charger settings for a ChargeAmps device.
   *
   * @param {number} userCurrent - The current limit to set for the charger.
   * @param {string} userRFID - The RFID to set for the charger.
   * @param {number} userMode - The mode to set for the charger (0 to stop charging).
   * @param {boolean} userCableLock - The cable lock setting for the charger.
   * @returns {Promise<void>} - A promise that resolves when the settings have been successfully updated.
   * @throws {Error} - Throws an error if the settings could not be updated.
   ***************************************************************************************/
  async setChargerSettings(userCurrent, userRFID, userMode, userCableLock) {
    try {
      this.logMessage('normal', `Setting charger settings in ChargeAmps with current limit: ${userCurrent}, userRFID: ${userRFID}, mode: ${userMode}, and cableLock: ${userCableLock}`);

      if (userMode === 0) {
        // Try to do a remoteStop if charging is turned off
        try {
          this.logMessage('trace', `Trying a remoteStop as requested mode is: ${userMode}`);
          await this.api().put(`/chargepoints/${this.chargeAmpsId}/connectors/1/remotestop`, {}, {
            headers: {
              Authorization: `Bearer ${this.chargeAmpsToken}`,
            },
          });
          // delay for 2 seconds to allow the charger to stop
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          this.logMessage('trace', "Failed to stop the charger:", error);
        }
      }

      // Set charger settings including current, RFID, mode, and cable lock
      await this.api().put(`/chargepoints/${this.chargeAmpsId}/connectors/1/settings`, {
        chargePointId: this.chargeAmpsId,
        maxCurrent: userCurrent,  // Set the max current from the parameter
        rfidLock: userRFID,       // Set RFID from the parameter
        mode: userMode,           // Set the mode from the parameter
        cableLock: userCableLock, // Set CableLock from the parameter
      }, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
      });

      this.logMessage('trace', `Charger settings updated: maxCurrent: ${userCurrent}, rfidLock: ${userRFID}, mode: ${userMode}, cableLock: ${userCableLock}`);
    } catch (error) {
      this.logMessage('error', "Error while setting charger settings:", error);
    }
  }

  /****************************************************************************************
   * Sets the light and dimmer value for the LED ring.
   *
   * @param {number} userDimmer - The desired dimmer value to set.
   * @returns {Promise<void>} - A promise that resolves when the dimmer value has been set.
   * @throws {Error} - Throws an error if the API request fails.
   ***************************************************************************************/
  async setLightAndDimmer(userDimmer) {
    try {
      this.logMessage('normal', "Setting LED ring has been initialized", { userDimmer });

      // Set the dimmer value in the API
      await this.api().put(`/chargepoints/${this.chargeAmpsId}/settings`, {
        id: this.chargeAmpsId,
        dimmer: userDimmer,
      }, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
      });

      this.logMessage('trace', `Dimmer setting updated to: ${userDimmer}`);
    } catch (error) {
      this.logMessage('error', "Error while setting LED ring:", error);
    }
  }

  // *********************************************
  // MODULES TO GET DATA FROM THE CHARGE AMPS API
  // *********************************************

  /****************************************************************************************
   * Continuously fetches Charge Amps data in a loop with dynamic timeout intervals.
   * 
   * This function checks if data collection is already in progress before attempting to fetch data.
   * If data collection is not in progress, it fetches the data and calculates the time taken for the operation.
   * Based on the elapsed time, it determines the next timeout interval within a specified range.
   * If an error occurs during data fetching, it retries after a fixed interval.
   * 
   * @async
   * @function getCAdataLoop
   * @returns {Promise<void>} No return value.
   ***************************************************************************************/
  async getCAdataLoop() {
    // Check the flag before running getCAdata
    if (!this.isGettingData) {
      try {
        const startTime = Date.now();
        await this.getCAdata();
        const endTime = Date.now();
        const elapsedTime = (endTime - startTime) / 1000;
        this.logMessage('normal', `INFORMATION: getCAdata took ${elapsedTime} seconds to complete`);

        const minTimeout = 19;
        const maxTimeout = 60;
        const timeout = Math.round(Math.max(minTimeout, Math.min(maxTimeout, minTimeout + (elapsedTime * 2) / 3)));

        this.logMessage('normal', `Next getCAdata will be executed in ${timeout} seconds`);
        setTimeout(() => this.getCAdataLoop(), timeout * 1000);
      } catch (error) {
        this.logMessage('error', "Error during getCAdata execution:", error);
        setTimeout(() => this.getCAdataLoop(), 19 * 1000);
      }
    } else {
      this.logMessage('trace', "getCAdataLoop: Data collection is already running, retrying in 19 seconds");
      setTimeout(() => this.getCAdataLoop(), 19 * 1000);
    }
  }

  /****************************************************************************************
   * Fetches data from the ChargeAmps API and updates the device's status and capabilities.
   * 
   * This method performs the following steps:
   * 1. Logs the initialization message.
   * 2. Checks if the data fetching process is already running.
   * 3. Sets a flag to indicate that data fetching is in progress.
   * 4. Makes an API call to fetch the status of the charge point.
   * 5. Logs the received data.
   * 6. Retrieves the old data from the device's capabilities.
   * 7. Updates the consumption data if charging is active.
   * 8. Handles the status change for the charger and triggers corresponding flow cards.
   * 9. Updates the device's capabilities based on the new status.
   * 10. Logs any errors encountered during the process.
   * 11. Calls the getLightinfo method to update light information.
   * 
   * @async
   * @returns {Promise<void>} A promise that resolves when the data fetching and updating process is complete.
   ***************************************************************************************/
  async getCAdata() {
    this.logMessage('normal', "Getting ChargeAmps data has been initialized");

    // Check the flag before running the code
    if (this.isGettingData) {
      this.logMessage('trace', "getCAdata is already running, skipping");
      return;
    }

    // Set the flag to true when getCAdata starts running
    this.isGettingData = true;
    try {
      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/status`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      this.logMessage('full', 'LUNA Status data received from ChargeAmps:', JSON.stringify(response.data, null, 2));

      // Get the old data from Capabilities
      let originalCarConnected = this.getCapabilityValue("lunaCarConnected");
      this.logMessage('trace', 'originalCarConnected:', originalCarConnected);

      // Get new data from the ChargeAmps API
      this.nowConsumptionKwh = response.data.connectorStatuses[0].totalConsumptionKwh;
      this.logMessage('trace', 'nowConsumptionKwh:', this.nowConsumptionKwh);

      // If charging is active then calculate the consumption
      if (this.nowConsumptionKwh !== 0) {
        let { measurements } = response.data.connectorStatuses[0];
        if (measurements.length > 0) {
          let consumption = measurements.slice(0, 3).reduce((acc, measurement) => acc + measurement.current * measurement.voltage, 0);
          this.chargingConsumptionKwh = consumption / 1000;
          this.logMessage('trace', 'chargingConsumptionKwh:', this.chargingConsumptionKwh);
        }
      }

      let { status } = response.data.connectorStatuses[0];
      this.logMessage('trace', 'status:', status);

      // Correct originalCarConnected so that it uses the API value when not connected
      if (originalCarConnected === "Disconnected") {
        originalCarConnected = "Available";
      }
      let chargerStatus = status;

      if (originalCarConnected === "Charging" && status === "Connected") {
        chargerStatus = "Connected";
        this.homey.flow.getDeviceTriggerCard("luna-chargerChargingCompleted").trigger(this, {}, {}).catch(this.error);
        originalCarConnected = "Connected";
        await this.setCapabilityValue("lunaCarConnected", chargerStatus);
        this.logMessage('trace', 'Set lunaCarConnected to:', chargerStatus);
      }

      // handle the status change for the charger
      if (status !== originalCarConnected) {
        switch (status) {
          case "Available":
            chargerStatus = "Disconnected";
            this.homey.flow.getDeviceTriggerCard("luna-chargerDisconnected").trigger(this, {}, {}).catch(this.error);
            this.logMessage('trace', 'Charger disconnected');
            break;
          case "Connected":
            chargerStatus = "Connected";
            this.homey.flow.getDeviceTriggerCard("luna-chargerConnected").trigger(this, {}, {}).catch(this.error);
            this.logMessage('trace', 'Charger connected');
            break;
          case "Charging":
            chargerStatus = "Charging";
            this.homey.flow.getDeviceTriggerCard("luna-chargerCharging").trigger(this, {}, {}).catch(this.error);
            this.logMessage('trace', 'Charger charging');
            break;
          default:
            chargerStatus = "Unknown";
            this.logMessage('trace', 'Unknown charger status');
            break;
        }
        await this.setCapabilityValue("lunaCarConnected", chargerStatus);
        this.logMessage('trace', 'Set lunaCarConnected to:', chargerStatus);
      }

    } catch (error) {
      this.logMessage('error', "Error:", error);
    } finally {
      await this.getChargingInfo();
    }
  }

  /***********************************************************************************************************************************
 * Fetches the charging information from the ChargeAmps API and updates the device's capabilities.
 * 
 * @async
 * @function getChargingInfo
 * @returns {Promise<void>} Resolves when the charging information has been fetched and capabilities updated.
 * 
 * @throws Will log an error message if the API request fails or any other error occurs during the process.
 * 
 * @example
 * await getChargingInfo();
 * 
 * @description
 * This function performs the following steps:
 * 1. Logs the start of the data fetching process.
 * 2. Makes an API request to fetch the latest charging sessions.
 * 3. Logs the received data.
 * 4. Retrieves and logs the current value of the "meter_luna" capability.
 * 5. If "meter_luna" is null, sets it to 0 and logs this action.
 * 6. If "nowConsumptionKwh" is 0, sets "previousConsumptionKwh" to 0, logs this action, and updates the "measure_luna" capability.
 * 7. If "nowConsumptionKwh" is not 0, calculates the delta, updates "meterChargingKWH", logs these actions, and updates the "measure_luna" and "meter_luna" capabilities.
 * 8. Updates the "lunaLastCharged" and "lunaNowCharged" capabilities with the latest charging information.
 * 9. Logs the completion of the data fetching process.
 **********************************************************************************************************************************/
  async getChargingInfo() {
    try {
      // Kontrollera om laddningsporten är påslagen innan API-anropet
      if (!this.getCapabilityValue('onoff')) {
        this.logMessage('normal', 'Charging port is OFF, skipping API call that collects charging data.');
        return; // Avbryt om porten är avstängd
      }
      this.logMessage('normal', 'Fetching charging info...');
      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/chargingsessions?maxCount=2`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      this.logMessage('full', 'LUNA Charging data received from ChargeAmps:', JSON.stringify(response.data, null, 2));

      let chargingInfo;
      this.meterChargingKWH = this.getCapabilityValue("meter_luna");
      this.logMessage('trace', 'Current meter_luna capability value:', this.meterChargingKWH);

      if (this.meterChargingKWH === null) {
        this.meterChargingKWH = 0;
        this.logMessage('trace', 'meter_luna is null, setting to 0');
      }

      if (this.nowConsumptionKwh === 0) {
        this.previousConsumptionKwh = 0;
        this.logMessage('trace', 'nowConsumptionKwh is 0, setting previousConsumptionKwh to 0');

        chargingInfo = response.data[0].totalConsumptionKwh.toFixed(2);
        this.logMessage('trace', 'Charging session data found, totalConsumptionKwh:', chargingInfo);

        await this.setCapabilityValue("measure_luna", 0);
        this.logMessage('trace', 'Setting measure_luna to 0');
      } else {
        const delta = this.nowConsumptionKwh - this.previousConsumptionKwh;
        this.meterChargingKWH += delta;
        this.logMessage('trace', 'Calculated delta:', delta);
        this.logMessage('trace', 'Updated meterChargingKWH:', this.meterChargingKWH);

        this.previousConsumptionKwh = this.nowConsumptionKwh;
        this.logMessage('trace', 'Updated previousConsumptionKwh:', this.previousConsumptionKwh);

        chargingInfo = response.data[1].totalConsumptionKwh.toFixed(2);
        this.logMessage('trace', 'Second charging session data found, totalConsumptionKwh:', chargingInfo);

        await Promise.all([
          this.setCapabilityValue("measure_luna", this.chargingConsumptionKwh),
          this.setCapabilityValue("meter_luna", this.meterChargingKWH),
        ]);

        this.logMessage('trace', 'Set measure_luna to:', this.chargingConsumptionKwh);
        this.logMessage('trace', 'Set meter_luna to:', this.meterChargingKWH);
      }

      await Promise.all([
        this.setCapabilityValue("lunaLastCharged", chargingInfo),
        this.setCapabilityValue("lunaNowCharged", this.nowConsumptionKwh.toFixed(2)),
      ]);

      this.logMessage('trace', 'Set lunaLastCharged to:', chargingInfo);
      this.logMessage('trace', 'Set lunaNowCharged to:', this.nowConsumptionKwh.toFixed(2));

    } catch (error) {
      this.logMessage('error', "Error:", error);
    } finally {
      this.isGettingData = false;
      this.logMessage('normal', "Finished data collection from ChargeAmps API");
    }
  }

  /********************************************************************************************/
  async getHourlyData() {
    await this.getOwnedChargepointsInfo();
  }

  /****************************************************************************************
     * Fetches information about owned chargepoints from the ChargeAmps API.
     * 
     * This method performs an API call to retrieve data about chargepoints owned by the user.
     * It logs the response data, searches for a device matching the current chargeAmpsId,
     * and updates the firmware version and OCPP/CAPI version accordingly.
     * 
     * @async
     * @function getOwnedChargepointsInfo
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     * @throws Will log an error message if the API call fails or if no matching device is found.
     ***************************************************************************************/
  async getOwnedChargepointsInfo() {
    try {
      this.logMessage('normal', 'Fetching owned chargepoints info...');

      // make an API call to retrieve data about chargepoints owned by the user
      let response = await this.api().get(`/chargepoints/owned`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      // log the response data
      this.logMessage('full', 'Owned chargepoints data received from ChargeAmps:', JSON.stringify(response.data, null, 2));

      if (Array.isArray(response.data) && response.data.length > 0) {
        // search for a device matching the current chargeAmpsId
        const matchedDevice = response.data.find(device => device.id === this.chargeAmpsId);

        if (matchedDevice) {
          // store the firmware version and OCPP/CAPI version from the matched device
          this.firmwareVersion = matchedDevice.firmwareVersion;
          this.logMessage('trace', 'Matched device firmwareVersion:', this.firmwareVersion);

          // set the OCPP/CAPI version based on the matched device
          this.ocppVersion = matchedDevice.ocppVersion === null ? 'CAPI' : 'OCPP';
          this.logMessage('trace', 'Matched device ocppVersion:', this.ocppVersion);

          // log the firmware version and OCPP/CAPI version
          this.logMessage('normal', `Firmware Version: ${this.firmwareVersion}`);
          this.logMessage('normal', `OCPP/CAPI Version: ${this.ocppVersion}`);

          // set the capabilities lunaFW and lunaVersion with the firmware and OCPP/CAPI version
          await Promise.all([
            this.setCapabilityValue('lunaFW', this.firmwareVersion),
            this.logMessage('trace', 'Set lunaFW to:', this.firmwareVersion),

            this.setCapabilityValue('lunaVersion', this.ocppVersion),
            this.logMessage('trace', 'Set lunaVersion to:', this.ocppVersion),
          ]);
        } else {
          this.logMessage('error', `No matching device found for ID: ${this.chargeAmpsId}`);
        }
      } else {
        this.logMessage('error', 'No chargepoints found in response');
      }

    } catch (error) {
      // handle any errors encountered during the process
      this.logMessage('error', 'Axios error:', error);
    } finally {
      await this.getLightinfo();
    }
  }

  /****************************************************************************************
   * Fetches and processes the LUNA lights information from ChargeAmps.
   * 
   * This method performs the following steps:
   * 1. Logs the start of the fetching process.
   * 2. Sends a GET request to retrieve the settings of the charge point.
   * 3. Logs the full response if the debug level is set to "full".
   * 4. Stores the dimmer status from the response.
   * 5. Sets the capabilities `lunaLEDringStatus` and `lunaLEDringButton` with the dimmer status.
   * 6. Logs the set capabilities if the debug level is set to "trace".
   * 7. Logs any errors encountered during the process.
   * 8. Calls the `getOwnedChargepointsInfo` method to continue the process.
   * 
   * @async
   * @function getLightinfo
   * @returns {Promise<void>} A promise that resolves when the process is complete.
   ***************************************************************************************/
  async getLightinfo() {
    try {
      this.logMessage('normal', 'Fetching LUNA lights info...');

      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/settings`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      // log the full response if the debug level is set to "full"
      this.logMessage('full', 'LUNA Lights data received from ChargeAmps:', JSON.stringify(response.data, null, 2));

      // store the dimmer status from the response
      this.statusLEDring = response.data.dimmer;
      this.logMessage('trace', 'statusLEDring:', this.statusLEDring);

      // set the capabilities lunaLEDringStatus and lunaLEDringButton with the dimmer status
      await Promise.all([
        this.setCapabilityValue("lunaLEDringStatus", response.data.dimmer),
        this.logMessage('trace', 'Set lunaLEDringStatus to:', response.data.dimmer),

        this.setCapabilityValue("lunaLEDringButton", response.data.dimmer),
        this.logMessage('trace', 'Set lunaLEDringButton to:', response.data.dimmer),
      ]);

    } catch (error) {
      //log any errors encountered during the process
      this.logMessage('error', "Error:", error);
    } finally {
      await this.getChargerInfo();
    }
  }

  /****************************************************************************************
   * Fetches charger information from the ChargeAmps API and updates the device's capabilities.
   * 
   * @async
   * @function getChargerInfo
   * @returns {Promise<void>} A promise that resolves when the charger information has been fetched and capabilities updated.
   * @throws Will log an error message if the API request fails.
   * 
   * @description
   * This function performs the following steps:
   * 1. Logs a message indicating the start of the fetch process.
   * 2. Sends a GET request to the ChargeAmps API to retrieve charger settings.
   * 3. Logs the received data.
   * 4. Updates the device's current, status, RFID lock, and cable lock properties.
   * 5. Logs the updated properties.
   * 6. Updates the device's capabilities based on the fetched data.
   * 7. Logs the updated capabilities.
   * 8. If an error occurs during the API request, logs the error message.
   * 9. Finally, calls the `getChargingInfo` function.
   ***************************************************************************************/
  async getChargerInfo() {
    try {
      this.logMessage('normal', 'Fetching charger info...');
      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/connectors/1/settings`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      this.logMessage('full', 'LUNA Charging data received from ChargeAmps:', JSON.stringify(response.data, null, 2));

      this.lunaCurrent = response.data.maxCurrent;
      this.lunaChargerStatus = response.data.mode;
      this.statusRFID = response.data.rfidLock;
      this.statusCableLock = response.data.cableLock;

      this.logMessage('trace', 'lunaCurrent:', this.lunaCurrent);
      this.logMessage('trace', 'lunaChargerStatus:', this.lunaChargerStatus);
      this.logMessage('trace', 'statusRFID:', this.statusRFID);
      this.logMessage('trace', 'statusCableLock:', this.statusCableLock);

      await Promise.all([
        this.setCapabilityValue('lunaChargerStatus', this.lunaChargerStatus),
        this.setCapabilityValue('onoff', this.lunaChargerStatus === 'On'),
        this.setCapabilityValue('lunaCurrentLimit', this.lunaCurrent),
        this.setCapabilityValue('lunaRFIDStatus', this.statusRFID ? 'On' : 'Off'),
        this.setCapabilityValue('lunaRFIDButton', this.statusRFID),
        this.setCapabilityValue('lunaCableLockStatus', this.statusCableLock ? 'On' : 'Off'),
        this.setCapabilityValue('lunaCableLockButton', this.statusCableLock),
      ]);

      this.logMessage('trace', 'Set lunaChargerStatus to:', this.lunaChargerStatus);
      this.logMessage('trace', 'Set onoff to:', this.lunaChargerStatus === 'On');
      this.logMessage('trace', 'Set lunaCurrentLimit to:', this.lunaCurrent);
      this.logMessage('trace', 'Set lunaRFIDStatus to:', this.statusRFID ? 'On' : 'Off');
      this.logMessage('trace', 'Set lunaRFIDButton to:', this.statusRFID);
      this.logMessage('trace', 'Set lunaCableLockStatus to:', this.statusCableLock ? 'On' : 'Off');
      this.logMessage('trace', 'Set lunaCableLockButton to:', this.statusCableLock);

    } catch (error) {
      this.logMessage('error', "Error:", error);
    } finally {
      this.logMessage('normal', 'Finished hourly info collection from HALO');
    }
  }
}
module.exports = LUNADevice;