"use strict";

const { Device } = require("homey");
const axios = require("axios");

/********************************************************************************************
 * HALODevice class extends the Device class and manages the initialization, settings, and interactions
 * with the ChargeAmps HALO device. It includes methods for logging, setting capabilities, registering
 * listeners, and interacting with the ChargeAmps API.
 * 
 * @class HALODevice
 * @extends Device
 * 
 * @property {string|null} chargeAmpsToken - The token for ChargeAmps API authentication.
 * @property {string|null} chargeAmpsRefreshToken - The refresh token for ChargeAmps API authentication.
 * @property {string} chargeAmpsId - The specific device ID passed from the pairing process.
 * @property {number|null} haloCurrent - The current limit for the HALO device.
 * @property {string|null} haloChargerStatus - The status of the HALO charger.
 * @property {string|null} haloOutletStatus - The status of the HALO outlet.
 * @property {boolean} isGettingData - Flag indicating if data is being fetched from the API.
 * @property {string|null} statusDownLight - The status of the downlight.
 * @property {string|null} statusLEDring - The status of the LED ring.
 * @property {string|null} statusRFID - The status of the RFID.
 * @property {number|null} nowConsumptionKwh - The current consumption in kWh.
 * @property {number|null} chargingConsumptionKwh - The consumption during charging in kWh.
 * @property {number|null} meterChargingKWH - The meter reading for charging in kWh.
 * @property {number|null} previousConsumptionKwh - The previous consumption in kWh.
 * @property {string} debugLevel - The debug level for logging.
 * 
 * @method onInit - Initializes the HALO Device.
 * @method logMessage - Central log function based on debug level.
 * @method basicPreparation - Prepares the device by setting up capabilities, listeners, and flow cards.
 * @method registerCapabilityListeners - Registers capability listeners for user interactions.
 * @method registerFlowCards - Registers flow cards to enable user-defined automations.
 * @method onOnOffCapabilityChange - Handles On/Off capability change for the charger.
 * @method onHaloDownLightButton - Handles DownLight button toggle.
 * @method onHaloOutletButton - Handles Outlet button toggle.
 * @method onHaloLEDringButton - Handles LED Ring button toggle.
 * @method onhaloRFIDButton - Handles RFID button toggle.
 * @method onSettings - Handles changes in settings.
 * @method api - Creates an axios instance for API calls to Charge Amps.
 * @method loginCA - Logs into the ChargeAmps API and retrieves tokens.
 * @method renewToken - Renews the Charge Amps API token.
 * @method renewTokenLoop - Loops to renew the API token every 59 minutes.
 * @method setChargerSettings - Sets charger settings like current limit, RFID lock, and mode.
 * @method setLightAndDimmer - Sets the DownLight and Dimmer settings in the Charge Amps API.
 * @method setOutlet - Sets the Outlet status in the Charge Amps API.
 * @method getCAdataLoop - Loops to get Charge Amps data every 15-60 seconds.
 * @method getCAdata - Gets data from Charge Amps API.
 *******************************************************************************************/

class HALODevice extends Device {

  /*******************************************************************************************
   * Initializes the HALO Device.
   * 
   * This method performs the following actions:
   * - Logs the initialization message.
   * - Defines and initializes various device-related variables.
   * - Logs the retrieved device ID.
   * - Calls a module to check capabilities, set capability listeners, and define flow cards.
   * - Logs into the ChargeAmps API using credentials from settings.
   * - Initializes the loop to get ChargeAmps data.
   * - Initializes the loop to renew the token, with the first run after 30 minutes.
   * 
   * @async
   * @throws {Error} If login to ChargeAmps API fails.
   *******************************************************************************************/
  async onInit() {
    this.logMessage('normal', 'HALO Device has been initialized');

    // Define variables
    this.chargeAmpsToken = null;
    this.chargeAmpsRefreshToken = null;
    this.chargeAmpsId = this.getData().id; // Retrieve the specific device ID passed from the pairing process
    this.haloCurrent = null;
    this.haloChargerStatus = null;
    this.haloOutletStatus = null;
    this.isGettingData = false;
    this.statusDownLight = null;
    this.statusLEDring = null;
    this.statusRFID = null;
    this.nowConsumptionKwh = null;
    this.chargingConsumptionKwh = null;
    this.meterChargingKWH = null;
    this.previousConsumptionKwh = null;
    this.debugLevel = this.getSetting('debugLevel') || 'normal';

    // Log the id to ensure a value has been recieved
    this.logMessage('normal', `chargeAmpsId retrieved: ${this.chargeAmpsId}`);

    // Call module to Check Capabilities, set Capability Listeners, and define Flow Cards
    await this.basicPreparation();

    // Login to ChargeAmps API
    try {
      await this.loginCA(this.homey.settings.get('email'), this.homey.settings.get('password'), this.homey.settings.get('APIkey'));
    } catch (error) {
      this.logMessage('error', 'Login failed:', error);
      throw new Error('Failed to log in to ChargeAmps API');
    }

    // Initial collection of basic data from ChargeAmps
    await this.getHourlyData();

    // Initialize the collection of the most needed ChargeAmps Data in a Loop
    this.getCAdataLoop();

    // Initialize Renew Token Loop (first run after 30min)
    setTimeout(() => this.renewTokenLoop(), 1000 * 60 * 30); // 30 minutes delay for the first execution
  }

  /********************************************************************************************
   * Logs messages based on the specified debug level.
   *
   * @param {string} level - The level of the message to log. Can be 'off', 'normal', 'trace', 'full', or 'error'.
   * @param {...any} messages - The messages to log.
   *******************************************************************************************/
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

  /********************************************************************************************
   * Prepares the device by removing old capabilities and adding new ones.
   * 
   * This method performs the following steps:
   * 1. Checks and removes old capabilities if they exist.
   * 2. Defines and adds new capabilities in the correct order if they are not already added.
   * 3. Registers capability listeners for user interactions.
   * 4. Registers flow cards to enable user-defined automations.
   * 
   * @async
   * @function basicPreparation
   * @returns {Promise<void>} A promise that resolves when the preparation is complete.
   *******************************************************************************************/
  async basicPreparation() {

    // Check and remove old capabilities (measure_power, meter_power)
    const oldCapabilities = ['measure_power', 'meter_power', 'haloChargerStatus', 'haloOutletStatus', 'haloCarConnected', 'haloCurrentLimit', 'haloLastCharged', 'haloNowCharged', 'haloFW', 'haloVersion', 'haloDownLightStatus', 'haloLEDringStatus', 'haloRFIDStatus'];

    for (const capability of oldCapabilities) {
      if (this.hasCapability(capability)) {
        this.logMessage('trace', `Removing old capability: ${capability}`);
        await this.removeCapability(capability);
      }
    }

    // Define and add capabilities if they are not already added in the correct order
    const capabilities = [
      "measure_halo",
      "meter_halo",
      "onoff",
      "haloOutletButton",
      "haloRFIDButton",
      "haloDownLightButton",
      "haloLEDringButton",
      "haloChargerStatus",
      "haloOutletStatus",
      "haloCarConnected",
      "haloCurrentLimit",
      "haloLastCharged",
      "haloNowCharged",
      "haloFW",
      "haloVersion",
      "haloDownLightStatus",
      "haloLEDringStatus",
      "haloRFIDStatus",
    ];

    for (const capability of capabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

    // Register capability listeners for user interactions
    this.registerCapabilityListeners();

    // Register flow cards to enable user-defined automations
    this.registerFlowCards();
  }

  /********************************************************************************************
   * Registers capability listeners for various device capabilities.
   * 
   * This method binds and registers the following capability listeners:
   * - 'onoff': Listener for the on/off capability.
   * - 'haloDownLightButton': Listener for the Halo down light button capability.
   * - 'haloOutletButton': Listener for the Halo outlet button capability.
   * - 'haloLEDringButton': Listener for the Halo LED ring button capability.
   * - 'haloRFIDButton': Listener for the Halo RFID button capability.
   *******************************************************************************************/
  registerCapabilityListeners() {
    this.registerCapabilityListener('onoff', this.onOnOffCapabilityChange.bind(this));
    this.registerCapabilityListener('haloDownLightButton', this.onHaloDownLightButton.bind(this));
    this.registerCapabilityListener('haloOutletButton', this.onHaloOutletButton.bind(this));
    this.registerCapabilityListener('haloLEDringButton', this.onHaloLEDringButton.bind(this));
    this.registerCapabilityListener('haloRFIDButton', this.onhaloRFIDButton.bind(this));
  }

  /********************************************************************************************
   * Registers flow cards for various actions and conditions in the Homey app.
   * 
   * This method sets up listeners for action cards to handle different device actions
   * such as changing the current, turning on/off the downlight, outlet, and RFID, 
   * and changing the LED ring. It also sets up listeners for condition cards to 
   * check the status of various device conditions such as car connection, charging status,
   * ground light status, outlet status, and RFID status.
   * 
   * Action Cards:
   * - halo-changecurrent: Changes the current limit.
   * - halo-turn-on-downlight: Turns on the downlight.
   * - halo-turn-off-downlight: Turns off the downlight.
   * - halo-turn-on-outlet: Turns on the outlet.
   * - halo-turn-off-outlet: Turns off the outlet.
   * - halo-change-led-ring: Changes the LED ring status.
   * - halo-turn-on-RFID: Turns on the RFID.
   * - halo-turn-off-RFID: Turns off the RFID.
   * 
   * Condition Cards:
   * - halo-carIsConnected: Checks if the car is connected.
   * - halo-carIsCharging: Checks if the car is charging.
   * - halo-groundLightIsOn: Checks if the ground light is on.
   * - halo-220VoutletIsOn: Checks if the 220V outlet is on.
   * - halo-RFIDStatus: Checks the RFID status.
   * 
   * @method registerFlowCards
   *******************************************************************************************/
  registerFlowCards() {
    const cardActionCurrent = this.homey.flow.getActionCard('halo-changecurrent');
    const cardActionDownLightOn = this.homey.flow.getActionCard('halo-turn-on-downlight');
    const cardActionDownLightOff = this.homey.flow.getActionCard('halo-turn-off-downlight');
    const cardActionOutletOn = this.homey.flow.getActionCard('halo-turn-on-outlet');
    const cardActionOutletOff = this.homey.flow.getActionCard('halo-turn-off-outlet');
    const cardActionLEDring = this.homey.flow.getActionCard('halo-change-led-ring');
    const cardActionRFIDOn = this.homey.flow.getActionCard('halo-turn-on-RFID');
    const cardActionRFIDOff = this.homey.flow.getActionCard('halo-turn-off-RFID');
    const cardConditionCarConnected = this.homey.flow.getConditionCard('halo-carIsConnected');
    const cardConditionGroundLightOn = this.homey.flow.getConditionCard('halo-groundLightIsOn');
    const cardCondition220VoutletIsOn = this.homey.flow.getConditionCard('halo-220VoutletIsOn');
    const cardConditionCarIsCharging = this.homey.flow.getConditionCard('halo-carIsCharging');
    const cardConditionRFID = this.homey.flow.getConditionCard('halo-RFIDStatus');

    // Register flow card listeners for actions
    cardActionCurrent.registerRunListener(async (args) => {
      const { Current } = args;
      this.haloCurrent = Current;
      this.logMessage('trace', 'Current value received:', Current);

      await Promise.all([
        this.setSettings({ settingsCurrentLimit: Current }),
        this.setChargerSettings(Current, this.statusRFID, this.haloChargerStatus),
        this.setCapabilityValue('haloCurrentLimit', Current),
      ]);

      this.logMessage('trace', 'Updated haloCurrentLimit capability to:', Current);
      this.logMessage('normal', 'Current limit has been set to:', Current);
    });

    cardActionLEDring.registerRunListener(async (args) => {
      const { LEDring } = args;
      this.statusLEDring = LEDring;
      this.logMessage('trace', 'LED Ring value received:', LEDring);

      await Promise.all([
        this.setLightAndDimmer(this.statusDownLight, LEDring),
        this.setCapabilityValue('haloLEDringStatus', LEDring),
      ]);

      this.logMessage('trace', 'Updated haloLEDringStatus capability to:', LEDring);
      this.logMessage('normal', 'LED Ring has been set to:', LEDring);
    });

    cardActionDownLightOn.registerRunListener(async () => {
      this.statusDownLight = true;
      this.logMessage('trace', 'DownLight turned ON');

      await Promise.all([
        this.setLightAndDimmer(true, this.statusLEDring),
        this.setCapabilityValue('haloDownLightStatus', 'On'),
        this.setCapabilityValue('haloDownLightButton', true),
      ]);

      this.logMessage('trace', 'Updated haloDownLightStatus to: On');
      this.logMessage('trace', 'Updated haloDownLightButton to: true');
    });

    cardActionDownLightOff.registerRunListener(async () => {
      this.statusDownLight = false;
      this.logMessage('trace', 'DownLight turned OFF');

      await Promise.all([
        this.setLightAndDimmer(false, this.statusLEDring),
        this.setCapabilityValue('haloDownLightStatus', 'Off'),
        this.setCapabilityValue('haloDownLightButton', false),
      ]);

      this.logMessage('trace', 'Updated haloDownLightStatus to: Off');
      this.logMessage('trace', 'Updated haloDownLightButton to: false');
    });

    cardActionOutletOn.registerRunListener(async () => {
      const cardTriggerOutletOn = this.homey.flow.getDeviceTriggerCard('halo-outlet-switched-on');
      cardTriggerOutletOn.trigger(this, {}, {}).catch(this.error);
      this.logMessage('trace', 'Outlet turned ON');

      await Promise.all([
        this.setOutlet(this.statusRFID, 'On'),
        this.setCapabilityValue('haloOutletStatus', 'On'),
        this.setCapabilityValue('haloOutletButton', true),
      ]);

      this.logMessage('trace', 'Updated haloOutletStatus to: On');
      this.logMessage('trace', 'Updated haloOutletButton to: true');
    });

    cardActionOutletOff.registerRunListener(async () => {
      const cardTriggerOutletOff = this.homey.flow.getDeviceTriggerCard('halo-outlet-switched-off');
      cardTriggerOutletOff.trigger(this, {}, {}).catch(this.error);
      this.logMessage('trace', 'Outlet turned OFF');

      await Promise.all([
        this.setOutlet(this.statusRFID, 'Off'),
        this.setCapabilityValue('haloOutletStatus', 'Off'),
        this.setCapabilityValue('haloOutletButton', false),
      ]);

      this.logMessage('trace', 'Updated haloOutletStatus to: Off');
      this.logMessage('trace', 'Updated haloOutletButton to: false');
    });

    cardActionRFIDOn.registerRunListener(async () => {
      const cardTriggerRFIDOn = this.homey.flow.getDeviceTriggerCard('halo-RFID-switched-on');
      cardTriggerRFIDOn.trigger(this, {}, {}).catch(this.error);
      this.statusRFID = true;
      this.logMessage('trace', 'RFID turned ON');

      await Promise.all([
        this.setChargerSettings(this.haloCurrent, true, this.haloChargerStatus),
        this.setCapabilityValue('haloRFIDStatus', 'On'),
        this.setCapabilityValue('haloRFIDButton', true),
      ]);

      this.logMessage('trace', 'Updated haloRFIDStatus to: On');
      this.logMessage('trace', 'Updated haloRFIDButton to: true');
    });

    cardActionRFIDOff.registerRunListener(async () => {
      const cardTriggerRFIDOff = this.homey.flow.getDeviceTriggerCard('halo-RFID-switched-off');
      cardTriggerRFIDOff.trigger(this, {}, {}).catch(this.error);
      this.statusRFID = false;
      this.logMessage('trace', 'RFID turned OFF');

      await Promise.all([
        this.setChargerSettings(this.haloCurrent, false, this.haloChargerStatus),
        this.setCapabilityValue('haloRFIDStatus', 'Off'),
        this.setCapabilityValue('haloRFIDButton', false),
      ]);

      this.logMessage('trace', 'Updated haloRFIDStatus to: Off');
      this.logMessage('trace', 'Updated haloRFIDButton to: false');
    });

    // Register condition card listeners
    cardConditionCarConnected.registerRunListener(() => this.getCapabilityValue('haloCarConnected') === 'Connected');
    cardConditionCarIsCharging.registerRunListener(() => this.getCapabilityValue('haloCarConnected') === 'Charging');
    cardConditionGroundLightOn.registerRunListener(() => this.getCapabilityValue('haloDownLightStatus') === 'On');
    cardCondition220VoutletIsOn.registerRunListener(() => this.getCapabilityValue('haloOutletStatus') === 'On');
    cardConditionRFID.registerRunListener(() => this.getCapabilityValue('haloRFIDStatus') === 'On');
  }

  /********************************************************************************************
   * Handles the change in the On/Off capability of the charger.
   * 
   * @param {boolean} value - The new value of the On/Off capability. 
   *                          `true` for On, `false` for Off.
   * @returns {Promise<void>} - A promise that resolves when the operation is complete.
   *******************************************************************************************/
  async onOnOffCapabilityChange(value) {
    const mode = value ? 1 : 0;
    const status = value ? 'On' : 'Off';
    this.logMessage('normal', `Charger mode set to: ${mode}, Status set to: ${status}`);
    this.logMessage('trace', `Mode set to: ${mode}, Status set to: ${status}`);

    await Promise.all([
      this.setChargerSettings(this.haloCurrent, this.statusRFID, mode),
      this.setCapabilityValue('haloChargerStatus', status),
    ]);

    this.haloChargerStatus = value; // Update the internal variable
    this.logMessage('trace', `Updated haloChargerStatus: ${this.haloChargerStatus}`);
  }

  /********************************************************************************************
   * Handles the down light button action for the Halo device.
   *
   * @param {boolean} value - The value indicating whether the down light is turned on or off.
   * @returns {Promise<void>} A promise that resolves when the action is complete.
   *******************************************************************************************/
  async onHaloDownLightButton(value) {
    const status = value ? 'On' : 'Off';
    this.logMessage('normal', `DownLight ${status}`, value);
    this.logMessage('trace', `DownLight status set to: ${status}`);

    await this.setCapabilityValue('haloDownLightStatus', status); // Update capability for the UI

    await Promise.all([
      this.setLightAndDimmer(value, this.statusLEDring),
    ]);

    this.statusDownLight = value; // Update the internal variable
    this.logMessage('trace', `Updated statusDownLight: ${this.statusDownLight}`);
  }

  /********************************************************************************************
   * Handles the action when the Halo outlet button is pressed.
   *
   * @param {boolean} value - The value indicating the desired state of the outlet (true for 'On', false for 'Off').
   * @returns {Promise<void>} A promise that resolves when the outlet state has been updated.
   *******************************************************************************************/
  async onHaloOutletButton(value) {
    const status = value ? 'On' : 'Off';
    this.logMessage('normal', `Outlet ${status}`, value);
    this.logMessage('trace', `Outlet status set to: ${status}`);

    const cardAction = value ? 'halo-outlet-switched-on' : 'halo-outlet-switched-off';
    this.homey.flow.getDeviceTriggerCard(cardAction).trigger(this, {}, {}).catch(this.error);

    await Promise.all([
      this.setOutlet(this.statusRFID, status),
      this.setCapabilityValue('haloOutletStatus', status),
    ]);

    this.haloOutletStatus = value; // Update the internal variable
    this.logMessage('trace', `Updated haloOutletStatus: ${this.haloOutletStatus}`);
  }

  /********************************************************************************************
   * Handles the LED ring button action.
   *
   * @param {boolean} value - The new status value for the LED ring.
   * @returns {Promise<void>} A promise that resolves when the LED ring status has been updated.
   *******************************************************************************************/
  async onHaloLEDringButton(value) {
    this.logMessage('normal', 'LED Ring Status', value);
    this.logMessage('trace', `LED Ring status set to: ${value}`);

    await Promise.all([
      this.setLightAndDimmer(this.statusDownLight, value),
      this.setCapabilityValue('haloLEDringStatus', value),
    ]);

    this.statusLEDring = value; // Update the internal variable
    this.logMessage('trace', `Updated statusLEDring: ${this.statusLEDring}`);
  }

  /********************************************************************************************
   * Handles the RFID button press event for the Halo device.
   *
   * @param {boolean} value - The value indicating the RFID button status.
   * @returns {Promise<void>} A promise that resolves when the RFID status has been updated.
   *******************************************************************************************/
  async onhaloRFIDButton(value) {
    this.logMessage('normal', 'RFIDButton called with value:', value);
    this.logMessage('trace', `RFID status set to: ${value ? 'On' : 'Off'}`);

    await Promise.all([
      this.setChargerSettings(this.haloCurrent, value, this.haloChargerStatus),
      this.setCapabilityValue('haloRFIDStatus', value ? 'On' : 'Off'),
    ]);

    this.statusRFID = value; // Update the internal variable
    this.logMessage('trace', `Updated statusRFID: ${this.statusRFID}`);
  }

  /********************************************************************************************
   * Handles the settings change event.
   *
   * @async
   * @param {Object} param - The parameter object.
   * @param {Object} param.newSettings - The new settings object.
   * @param {number} [param.newSettings.debugLevel] - The new debug level, if changed.
   * @param {number} param.newSettings.settingsCurrentLimit - The new current limit for the halo.
   * @returns {Promise<void>} A promise that resolves when the settings have been updated.
   *******************************************************************************************/
  async onSettings({ newSettings }) {
    this.logMessage('normal', 'Settings were changed');

    // update the debug level if it has changed
    if (newSettings.debugLevel) {
      this.debugLevel = newSettings.debugLevel;  // update the debug level
      this.logMessage('normal', `Debug level updated to: ${this.debugLevel}`);
    }

    // Hhandler the current limit settings
    this.haloCurrent = newSettings.settingsCurrentLimit;
    await Promise.all([
      this.setChargerSettings(this.haloCurrent, this.statusRFID, this.haloChargerStatus),
      this.setCapabilityValue('haloCurrentLimit', this.haloCurrent),
    ]);
  }

  /********************************************************************************************
   * Creates an Axios instance configured for the ChargeAmps API.
   *
   * @returns {AxiosInstance} A configured Axios instance with the base URL set to the ChargeAmps API and a timeout of 25s.
   *******************************************************************************************/
  api() {
    return axios.create({
      baseURL: 'https://eapi.charge.space/api/v5',
      timeout: 25000,
      headers: {
        'Content-Type': 'application/json',
        accept: '*/*',
      },
    });
  }

  /********************************************************************************************
   * Logs in to the ChargeAmps service using the provided credentials and security key.
   *
   * @param {string} usr - The user's email address.
   * @param {string} pwd - The user's password.
   * @param {string} securityKey - The security key for the API.
   * @returns {Promise<string>} A promise that resolves to a string indicating the login status.
   * @throws {Error} Throws an error if the login process fails.
   *******************************************************************************************/
  async loginCA(usr, pwd, securityKey) {
    try {
      this.logMessage('normal', 'ChargeAmps login has been initialized');
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
      this.logMessage('trace', 'Token = ', this.chargeAmpsToken);
      this.logMessage('trace', 'RefreshToken = ', this.chargeAmpsRefreshToken);
      return 'Login Completed';
    } catch (error) {
      this.logMessage('error', 'An error occurred during the login process:', error.message);
      throw error;
    }
  }

  /********************************************************************************************
   * Asynchronously renews the ChargeAmps authentication token.
   * 
   * This method sends a POST request to the ChargeAmps API to refresh the authentication token
   * using the current token and refresh token. If successful, it updates the instance's token
   * and refresh token with the new values received from the API response.
   * 
   * @async
   * @function renewToken
   * @returns {Promise<void>} A promise that resolves when the token renewal process is complete.
   * @throws Will log an error message if the token renewal process encounters an error.
   *******************************************************************************************/
  async renewToken() {
    try {
      this.logMessage('normal', 'ChargeAmps renewToken has been initialized');
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
      this.logMessage('trace', 'Token = ', this.chargeAmpsToken);
      this.logMessage('trace', 'RefreshToken = ', this.chargeAmpsRefreshToken);
    } catch (error) {
      this.logMessage('error', 'Error encountred:', error);
    }
  }

  /********************************************************************************************
   * Continuously renews the token at regular intervals.
   * 
   * This function attempts to renew the token by calling `renewToken()`. 
   * If an error occurs during the renewal process, it logs the error message.
   * The function then sets a timeout to call itself again after 59 minutes.
   * 
   * @async
   * @function renewTokenLoop
   * @returns {Promise<void>} - A promise that resolves when the token renewal process completes.
   *******************************************************************************************/
  async renewTokenLoop() {
    try {
      await this.renewToken();
      // Call other modules to get the latest data on an hourly basis
      await this.getHourlyData();
    } catch (error) {
      this.logMessage('error', 'Error during renewToken execution:', error);
    }
    setTimeout(() => this.renewTokenLoop(), 1000 * 60 * 59);
  }

  /********************************************************************************************
   * Sets the charger settings in ChargeAmps.
   *
   * @param {number} userCurrent - The current limit to set for the charger.
   * @param {string} userRFID - The RFID to set for the charger.
   * @param {number} userMode - The mode to set for the charger. If the mode is 0, a remote stop will be attempted.
   * @returns {Promise<void>} - A promise that resolves when the settings have been successfully set.
   * @throws {Error} - Throws an error if there is an issue setting the charger settings.
   *******************************************************************************************/
  async setChargerSettings(userCurrent, userRFID, userMode) {
    try {
      this.logMessage('normal', `Setting charger settings in ChargeAmps with current limit: ${userCurrent}, userRFID: ${userRFID} and mode: ${userMode}`);

      if (userMode === 0) {
        try {
          this.logMessage('trace', `Trying a remoteStop as requested mode is: ${userMode}`);
          await this.api().put(`/chargepoints/${this.chargeAmpsId}/connectors/1/remotestop`, {}, {
            headers: {
              Authorization: `Bearer ${this.chargeAmpsToken}`,
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 2000));  // 2-second delay before the next API call
        } catch (error) {
          this.logMessage('error', 'Failed to stop the charger:', error);
          // Continue even if the stop failed
        }
      }

      // initiate the API call to set the charger settings
      await this.api().put(`/chargepoints/${this.chargeAmpsId}/connectors/1/settings`, {
        chargePointId: this.chargeAmpsId,
        maxCurrent: userCurrent, // set the current limit as per the parameter
        rfidLock: userRFID, // set the RFID lock as per the parameter
        mode: userMode, // set the mode as per the parameter
        cableLock: false,
      }, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
      });

    } catch (error) {
      this.logMessage('error', 'Error encountred:', error);
    }
  }

  /********************************************************************************************
   * Sets the down light and dimmer settings for the ChargeAmps device.
   *
   * @param {boolean} userLight - The desired state of the down light (true for on, false for off).
   * @param {number} userDimmer - The desired dimmer level (0-100).
   * @returns {Promise<void>} - A promise that resolves when the settings have been successfully updated.
   * @throws {Error} - Throws an error if the API request fails.
   *******************************************************************************************/
  async setLightAndDimmer(userLight, userDimmer) {
    try {
      this.logMessage('normal', 'Setting DownLight and LED ring has been initialized', { userLight, userDimmer });
      await this.api().put(`/chargepoints/${this.chargeAmpsId}/settings`, {
        id: this.chargeAmpsId,
        downLight: userLight,
        dimmer: userDimmer,
      }, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
      });
    } catch (error) {
      this.logMessage('error', 'Error encountred:', error);
    }
  }

  /********************************************************************************************
   * Asynchronously sets the outlet state by sending a PUT request to the ChargeAmps API.
   *
   * @param {string} userRFID - The RFID of the user to lock/unlock the outlet.
   * @param {string} userMode - The mode to set for the outlet.
   * @returns {Promise<void>} - A promise that resolves when the request is complete.
   * @throws {Error} - Throws an error if the request fails.
   *******************************************************************************************/
  async setOutlet(userRFID, userMode) {
    try {
      this.logMessage('normal', `Turning ON/OFF Outlet has been initialized with userRFID: ${userRFID}`);
      await this.api().put(`/chargepoints/${this.chargeAmpsId}/connectors/2/settings`, {
        chargePointId: this.chargeAmpsId,
        rfidLock: userRFID,
        mode: userMode,
        cableLock: false,
      }, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
      });
    } catch (error) {
      this.logMessage('error', 'Error encountred:', error);
    }
  }

  /********************************************************************************************
   * Initiates a loop to repeatedly fetch Charge Amps data at dynamically calculated intervals.
   * 
   * The interval is based on the time taken to fetch the data, with a minimum of 19 seconds and a maximum of 90 seconds.
   * If an error occurs during data fetching, the loop will retry after 19 seconds.
   * 
   * @async
   * @function getCAdataLoop
   * @returns {Promise<void>} No return value.
   *******************************************************************************************/
  async getCAdataLoop() {
    if (!this.isGettingData) {
      try {
        const startTime = Date.now();
        await this.getCAdata();
        const endTime = Date.now();
        const elapsedTime = (endTime - startTime) / 1000;
        this.logMessage('normal', `INFORMATION: Info collection took ${elapsedTime} seconds to complete`);

        const minTimeout = 19;
        const maxTimeout = 90;
        const timeout = Math.round(Math.max(minTimeout, Math.min(maxTimeout, minTimeout + (elapsedTime * 2) / 3)));

        this.logMessage('normal', `INFORMATION: Next info collection in ${timeout} seconds`);
        setTimeout(() => this.getCAdataLoop(), timeout * 1000);
      } catch (error) {
        this.logMessage('error', 'Error during getCAdata execution:', error);
        setTimeout(() => this.getCAdataLoop(), 19 * 1000);
      }
    } else {
      setTimeout(() => this.getCAdataLoop(), 19 * 1000);
    }
  }

  /********************************************************************************************
   * Fetches ChargeAmps data and updates the device's status and capabilities accordingly.
   * 
   * This method performs the following steps:
   * 1. Logs the initialization of data fetching.
   * 2. Checks if data fetching is already in progress and skips if true.
   * 3. Sends a request to the ChargeAmps API to get the status of the charge point.
   * 4. Logs the received data and updates the device's consumption and status.
   * 5. Triggers appropriate Homey flow cards based on the status changes.
   * 6. Updates the device's capabilities with the new status.
   * 7. Handles any errors encountered during the process.
   * 8. Calls the `getLightinfo` method to update light information.
   * 
   * @async
   * @returns {Promise<void>} A promise that resolves when the data fetching and updating process is complete.
   *******************************************************************************************/
  async getCAdata() {
    // Log initialization of data fetching
    this.logMessage('normal', 'Fetching HALO Status info from ChargeAmps API...');

    // Check if data fetching is already in progress
    if (this.isGettingData) {
      this.logMessage('trace', 'getCAdata is already running, skipping');
      return;
    }

    // Mark the data fetching process as running
    this.isGettingData = true;
    try {
      // API request to get charge point status
      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/status`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      // Log full API response if debug level is set to 'full'
      this.logMessage('full', 'HALO Status data received from ChargeAmps API:', JSON.stringify(response.data, null, 2));

      // Retrieve and log the original 'haloCarConnected' capability value
      let originalCarConnected = this.getCapabilityValue('haloCarConnected');
      this.logMessage('trace', 'Capability "haloCarConnected" current value:', originalCarConnected);

      // Retrieve and log 'totalConsumptionKwh' from the API response
      this.nowConsumptionKwh = response.data.connectorStatuses[0].totalConsumptionKwh;
      this.logMessage('trace', 'API response: nowConsumptionKwh =', this.nowConsumptionKwh);

      // If charging is active, calculate 'chargingConsumptionKwh'
      if (this.nowConsumptionKwh !== 0) {
        const { measurements } = response.data.connectorStatuses[0];
        if (measurements.length > 0) {
          const consumption = measurements.slice(0, 3).reduce((acc, measurement) => acc + measurement.current * measurement.voltage, 0);
          this.chargingConsumptionKwh = consumption / 1000;
          this.logMessage('trace', 'Calculated chargingConsumptionKwh:', this.chargingConsumptionKwh);
        }
      }

      // Retrieve and log the 'status' from the API response
      let { status } = response.data.connectorStatuses[0];
      this.logMessage('trace', 'API response: charger status =', status);

      // Update originalCarConnected if it was 'Disconnected'
      if (originalCarConnected === 'Disconnected') {
        originalCarConnected = 'Available';
        this.logMessage('trace', 'Updated originalCarConnected from "Disconnected" to "Available"');
      }
      let chargerStatus = status;

      // Handle transition from 'Charging' to 'Connected' and trigger appropriate flow card
      if (originalCarConnected === 'Charging' && status === 'Connected') {
        chargerStatus = 'Connected';
        this.homey.flow.getDeviceTriggerCard('halo-chargerChargingCompleted').trigger(this, {}, {}).catch(this.error);
        originalCarConnected = 'Connected';
        this.logMessage('trace', 'Triggered "halo-chargerChargingCompleted" and updated haloCarConnected to "Connected"');
        await this.setCapabilityValue('haloCarConnected', chargerStatus);
        this.logMessage('trace', `Capability "haloCarConnected" updated to: ${chargerStatus}`);
      }

      // Handle status change and trigger corresponding flow card
      if (status !== originalCarConnected) {
        switch (status) {
          case 'Available':
            chargerStatus = 'Disconnected';
            this.homey.flow.getDeviceTriggerCard('halo-chargerDisconnected').trigger(this, {}, {}).catch(this.error);
            this.logMessage('trace', 'Triggered "halo-chargerDisconnected" and updated haloCarConnected to "Disconnected"');
            break;
          case 'Connected':
            chargerStatus = 'Connected';
            this.homey.flow.getDeviceTriggerCard('halo-chargerConnected').trigger(this, {}, {}).catch(this.error);
            this.logMessage('trace', 'Triggered "halo-chargerConnected" and updated haloCarConnected to "Connected"');
            break;
          case 'Charging':
            chargerStatus = 'Charging';
            this.homey.flow.getDeviceTriggerCard('halo-chargerCharging').trigger(this, {}, {}).catch(this.error);
            this.logMessage('trace', 'Triggered "halo-chargerCharging" and updated haloCarConnected to "Charging"');
            break;
          default:
            chargerStatus = status;
            this.logMessage('trace', `Status set to: ${status}`);
            break;
        }
        await this.setCapabilityValue('haloCarConnected', chargerStatus);
        this.logMessage('trace', `Capability "haloCarConnected" updated to: ${chargerStatus}`);
      }
    } catch (error) {
      // Log any errors encountered
      this.logMessage('error', 'Error encountered during API request:', error);
    } finally {
      // Fetch and update light information
      await this.getChargingInfo();
    }
  }

  /*******************************************************************************************
* Fetches the charging information for the HALO device from the ChargeAmps API.
* 
* This method retrieves the latest charging session data, updates the device's
* capability values, and logs relevant information for debugging and tracing purposes.
* 
* @async
* @function getChargingInfo
* @returns {Promise<void>} A promise that resolves when the charging information has been fetched and processed.
* @throws Will throw an error if the API request fails or if there is an issue processing the data.
*******************************************************************************************/
  async getChargingInfo() {
    try {
      // Kontrollera om laddningsporten är påslagen innan API-anropet
      if (!this.getCapabilityValue('onoff')) {
        this.logMessage('normal', 'Charging port is OFF, skipping API call that collects charging data.');
        return; // Avbryt om porten är avstängd
      }

      this.logMessage('normal', 'Fetching HALO charging info from ChargeAmps API...');
      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/chargingsessions?maxCount=2`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      this.logMessage('full', 'HALO Charging data received from API response:', JSON.stringify(response.data, null, 2));

      let chargingInfo;

      // Log current capability value for meter_halo
      this.meterChargingKWH = this.getCapabilityValue('meter_halo');
      this.logMessage('trace', 'Capability "meter_halo" current value:', this.meterChargingKWH);

      // If capability is null, set to 0 and log the change
      if (this.meterChargingKWH === null) {
        this.meterChargingKWH = 0;
        this.logMessage('trace', 'Capability "meter_halo" was null, setting it to 0.');
      }

      // Log current variable value for nowConsumptionKwh
      this.logMessage('trace', 'Variable "nowConsumptionKwh" current value:', this.nowConsumptionKwh);

      // If no consumption, set previous consumption to 0
      if (this.nowConsumptionKwh === 0) {
        this.logMessage('trace', 'Variable "nowConsumptionKwh" is 0, setting "previousConsumptionKwh" to 0.');
        this.previousConsumptionKwh = 0;

        // Log API response data processing
        if (response.data && response.data[0] && response.data[0].totalConsumptionKwh != null) {
          this.logMessage('trace', 'API response charging session data found for Charger. Processing totalConsumptionKwh...');
          chargingInfo = response.data[0].totalConsumptionKwh.toFixed(2);
        } else {
          this.logMessage('trace', 'No charging session data found in API response for Charger.');
          chargingInfo = '0';  // Fallback if no data is available
        }

        // Log and update capability measure_halo
        this.logMessage('trace', 'Updating capability "measure_halo" to 0.');
        await this.setCapabilityValue('measure_halo', 0);
      } else {

        // Calculate and log delta between nowConsumptionKwh and previousConsumptionKwh
        this.logMessage('trace', 'Calculating delta between "nowConsumptionKwh" and "previousConsumptionKwh"');
        const delta = this.nowConsumptionKwh - this.previousConsumptionKwh;
        this.meterChargingKWH += delta;
        this.logMessage('trace', 'Updated variable "meterChargingKWH" to:', this.meterChargingKWH);

        // Update and log previousConsumptionKwh
        this.previousConsumptionKwh = this.nowConsumptionKwh;
        this.logMessage('trace', 'Updated variable "previousConsumptionKwh" to:', this.previousConsumptionKwh);

        // Process second session if available
        if (response.data && response.data[1] && response.data[1].totalConsumptionKwh != null) {
          this.logMessage('trace', 'API response second charging session data found. Processing totalConsumptionKwh...');
          chargingInfo = response.data[1].totalConsumptionKwh.toFixed(2);
        } else {
          this.logMessage('trace', 'No second charging session data found in API response for Charger 2.');
          chargingInfo = '0';  // Fallback if no data is available
        }

        const validChargingConsumptionKwh = this.chargingConsumptionKwh !== undefined ? this.chargingConsumptionKwh : 0;
        this.logMessage('trace', 'Updating capabilities "measure_halo" and "meter_halo" with calculated values.');

        // Update capabilities and log the values
        await Promise.all([
          this.setCapabilityValue('measure_halo', validChargingConsumptionKwh),
          this.logMessage('trace', 'Capability "measure_halo" updated to:', validChargingConsumptionKwh),

          this.setCapabilityValue('meter_halo', this.meterChargingKWH),
          this.logMessage('trace', 'Capability "meter_halo" updated to:', this.meterChargingKWH)
        ]);
      }

      // Update haloLastCharged and haloNowCharged capabilities
      await Promise.all([
        this.setCapabilityValue('haloLastCharged', chargingInfo),
        this.logMessage('trace', 'Capability "haloLastCharged" updated to:', chargingInfo),

        this.setCapabilityValue('haloNowCharged', this.nowConsumptionKwh.toFixed(2)),
        this.logMessage('trace', 'Capability "haloNowCharged" updated to:', this.nowConsumptionKwh.toFixed(2))
      ]);
    } catch (error) {
      this.logMessage('error', 'Error encountered during getChargingInfo:', error);
    } finally {
      this.isGettingData = false;
      this.logMessage('normal', 'Finished info collection from ChargeAmps API');
    }
  }

  /********************************************************************************************/
  async getHourlyData() {
    await this.getOwnedChargepointsInfo();
  }

  /********************************************************************************************
* Fetches information about owned chargepoints from the ChargeAmps API.
* 
* This method makes an API call to the `/chargepoints/owned` endpoint to retrieve
* data about the chargepoints owned by the user. It then processes the response
* to find the chargepoint that matches the current device's ID, and updates the
* device's firmware version and OCPP/CAPI version accordingly. The updated values
* are logged and set as capabilities.
* 
* @async
* @returns {Promise<void>} A promise that resolves when the operation is complete.
* @throws Will log an error message if the API call fails or if no matching device is found.
*******************************************************************************************/
  async getOwnedChargepointsInfo() {
    try {
      // Log API request initiation
      this.logMessage('normal', 'Fetching owned chargepoints info from ChargeAmps API...');

      // API request to get owned chargepoints
      let response = await this.api().get(`/chargepoints/owned`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      // Log full API response if debug level is set to 'full'
      this.logMessage('full', 'Owned chargepoints data received from API response:', JSON.stringify(response.data, null, 2));

      if (Array.isArray(response.data) && response.data.length > 0) {
        // Search for the device with the matching chargeAmpsId
        const matchedDevice = response.data.find(device => device.id === this.chargeAmpsId);

        if (matchedDevice) {
          // Store and log firmware version from the API response
          this.firmwareVersion = matchedDevice.firmwareVersion;
          this.logMessage('trace', `API response: Firmware version received = ${this.firmwareVersion}`);

          // Store and log OCPP/CAPI version from the API response
          this.ocppVersion = matchedDevice.ocppVersion === null ? 'CAPI' : 'OCPP';
          this.logMessage('trace', `API response: OCPP/CAPI version received = ${this.ocppVersion}`);

          // Update capabilities with firmware version and OCPP/CAPI version, and log the updates
          await Promise.all([
            this.setCapabilityValue('haloFW', this.firmwareVersion),
            this.logMessage('trace', `Capability "haloFW" updated to: ${this.firmwareVersion}`),

            this.setCapabilityValue('haloVersion', this.ocppVersion),
            this.logMessage('trace', `Capability "haloVersion" updated to: ${this.ocppVersion}`)
          ]);
        } else {
          // Log if no matching device was found
          this.logMessage('error', `No matching device found for chargeAmpsId: ${this.chargeAmpsId}`);
        }
      } else {
        // Log if the response does not contain any chargepoints
        this.logMessage('error', 'No chargepoints found in the API response');
      }

      response = null;
    } catch (error) {
      // Handle any errors encountered during the API request
      this.logMessage('error', 'Error encountered during API request:', error);
    } finally {
      // Proceed to getOutletInfo regardless of success or failure
      await this.getLightinfo();
    }
  }

  /********************************************************************************************
   * Fetches and processes the HALO lights information from ChargeAmps.
   * 
   * This function performs the following steps:
   * 1. Logs the start of the fetching process.
   * 2. Sends a GET request to retrieve the settings of the charge point.
   * 3. Logs the received data if the debug level is set to 'full'.
   * 4. Stores the downLight and dimmer status from the response.
   * 5. Logs the stored variables if the debug level is set to 'trace'.
   * 6. Updates the capabilities with the received data and logs the updates if the debug level is set to 'trace'.
   * 7. Handles any errors encountered during the process.
   * 8. Finally, retrieves the owned charge points information.
   * 
   * @async
   * @function getLightinfo
   * @returns {Promise<void>} A promise that resolves when the operation is complete.
   *******************************************************************************************/
  async getLightinfo() {
    try {
      // Log API request initiation
      this.logMessage('normal', 'Fetching HALO lights info from ChargeAmps API...');

      // API request to get light settings
      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/settings`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      // Log full API response if debug level is set to 'full'
      this.logMessage('full', 'HALO Light data received from API response:', JSON.stringify(response.data, null, 2));

      // Store the downLight and dimmer status from the API response
      this.statusDownLight = response.data.downLight;
      this.statusLEDring = response.data.dimmer;

      // Log the stored variables from the API response if debug level is set to 'trace'
      this.logMessage('trace', `API response: statusDownLight = ${this.statusDownLight}`);
      this.logMessage('trace', `API response: statusLEDring = ${this.statusLEDring}`);

      // Update capabilities with the data from the API response, and log the updates
      await Promise.all([
        this.setCapabilityValue('haloLEDringStatus', response.data.dimmer),
        this.logMessage('trace', `Capability "haloLEDringStatus" updated to: ${response.data.dimmer}`),

        this.setCapabilityValue('haloLEDringButton', response.data.dimmer),
        this.logMessage('trace', `Capability "haloLEDringButton" updated to: ${response.data.dimmer}`),

        this.setCapabilityValue('haloDownLightStatus', response.data.downLight ? 'On' : 'Off'),
        this.logMessage('trace', `Capability "haloDownLightStatus" updated to: ${response.data.downLight ? 'On' : 'Off'}`),

        this.setCapabilityValue('haloDownLightButton', response.data.downLight),
        this.logMessage('trace', `Capability "haloDownLightButton" updated to: ${response.data.downLight}`)
      ]);

      response = null;
    } catch (error) {
      // Log any errors encountered during the API request
      this.logMessage('error', 'Error encountered during API request:', error);
    } finally {
      // Proceed to getOwnedChargepointsInfo regardless of success or failure
      await this.getOutletInfo();
    }
  }

  /********************************************************************************************
 * Fetches the HALO outlet information from the ChargeAmps API and updates the device capabilities accordingly.
 * 
 * @async
 * @function getOutletInfo
 * @returns {Promise<void>} A promise that resolves when the outlet information has been fetched and processed.
 * @throws Will log an error message if the API request fails.
 * 
 * @description
 * This function performs the following steps:
 * 1. Logs a message indicating that the HALO outlet info is being fetched.
 * 2. Sends a GET request to the ChargeAmps API to retrieve the outlet settings.
 * 3. Logs the received outlet data.
 * 4. Updates the `haloOutletStatus` property with the received data.
 * 5. Logs the `haloOutletStatus` if the debug level is set to trace.
 * 6. Checks if the `haloOutletStatus` has changed and, if so, triggers the appropriate flow and updates the device capabilities.
 * 7. Logs the updated capability values.
 * 8. Logs any errors encountered during the process.
 * 9. Finally, calls the `getChargerInfo` method to fetch additional charger information.
 *******************************************************************************************/
  async getOutletInfo() {
    try {
      // Log API request initiation
      this.logMessage('normal', 'Fetching HALO outlet info from ChargeAmps API...');

      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/connectors/2/settings`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      // Log full API response if debug level is 'full'
      this.logMessage('full', 'HALO Outlet data received from API response:', JSON.stringify(response.data, null, 2));

      // Store the outlet status from the API response
      this.haloOutletStatus = response.data.mode;
      this.logMessage('trace', `API response: Received outlet status (mode) = ${this.haloOutletStatus}`);

      const originalOutletStatus = this.getCapabilityValue('haloOutletStatus');
      const outletStatusDevice = this.haloOutletStatus === 'On';

      // If the outlet status has changed, trigger the appropriate flow and update capabilities
      if (this.haloOutletStatus !== originalOutletStatus) {
        this.homey.flow
          .getDeviceTriggerCard(outletStatusDevice ? 'halo-outlet-switched-on' : 'halo-outlet-switched-off')
          .trigger(this, {}, {})
          .catch(this.error);

        // Update capabilities and log the updates
        await Promise.all([
          // Update and log capability for outlet button
          this.setCapabilityValue('haloOutletButton', this.haloOutletStatus === 'On'),
          this.logMessage('trace', `Capability "haloOutletButton" updated to: ${this.haloOutletStatus === 'On'}`),

          // Update and log capability for outlet status
          this.setCapabilityValue('haloOutletStatus', this.haloOutletStatus),
          this.logMessage('trace', `Capability "haloOutletStatus" updated to: ${this.haloOutletStatus}`),

          // Update and log capability for RFID status based on the API response
          this.setCapabilityValue('haloRFIDStatus', response.data.rfidLock ? 'On' : 'Off'),
          this.logMessage('trace', `Capability "haloRFIDStatus" updated to: ${response.data.rfidLock ? 'On' : 'Off'}`)
        ]);
      }
    } catch (error) {
      // Log error if the API request fails
      this.logMessage('error', 'Error encountered during getOutletInfo:', error);
    } finally {
      // Always call getChargerInfo regardless of success or failure
      await this.getChargerInfo();
    }
  }

  /********************************************************************************************
 * Fetches the HALO charger information from the ChargeAmps API and updates the device capabilities.
 * 
 * @async
 * @function getChargerInfo
 * @returns {Promise<void>} A promise that resolves when the charger information has been fetched and capabilities updated.
 * @throws Will log an error message if the API request fails.
 * 
 * @example
 * // Example usage:
 * await getChargerInfo();
 * 
 * @description
 * This function performs the following steps:
 * 1. Logs a message indicating the start of the fetch process.
 * 2. Makes an API request to fetch the charger settings.
 * 3. Logs the received data if the debug level is set to 'full'.
 * 4. Stores and logs the charger settings if the debug level is set to 'trace'.
 * 5. Updates the device capabilities based on the fetched data and logs the updates if the debug level is set to 'trace'.
 * 6. Logs any errors encountered during the process.
 * 7. Calls `getChargingInfo` in the `finally` block to ensure it runs regardless of success or failure.
 *******************************************************************************************/
  async getChargerInfo() {
    try {
      // Log API request initiation
      this.logMessage('normal', 'Fetching HALO charger info from ChargeAmps API...');
      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/connectors/1/settings`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      // Log full API response if debug level is 'full'
      this.logMessage('full', 'HALO Charger data received from API response:', JSON.stringify(response.data, null, 2));

      // Log and store charger settings received from the API response
      this.haloCurrent = response.data.maxCurrent;
      this.haloChargerStatus = response.data.mode;
      this.statusRFID = response.data.rfidLock;

      this.logMessage('trace', `API response: Received maxCurrent from API = ${this.haloCurrent}`);
      this.logMessage('trace', `API response: Received mode (Charger Status) from API = ${this.haloChargerStatus}`);
      this.logMessage('trace', `API response: Received RFID status from API = ${this.statusRFID}`);

      // Update capabilities based on the fetched data and log capability updates
      await Promise.all([
        // Update and log capability for charger status
        this.setCapabilityValue('haloChargerStatus', this.haloChargerStatus),
        this.logMessage('trace', `Capability "haloChargerStatus" updated to: ${this.haloChargerStatus}`),

        // Update and log capability for on/off status based on the charger status
        this.setCapabilityValue('onoff', this.haloChargerStatus === 'On'),
        this.logMessage('trace', `Capability "onoff" updated to: ${this.haloChargerStatus === 'On'}`),

        // Update and log capability for current limit
        this.setCapabilityValue('haloCurrentLimit', this.haloCurrent),
        this.logMessage('trace', `Capability "haloCurrentLimit" updated to: ${this.haloCurrent}`),

        // Update and log capability for RFID status
        this.setCapabilityValue('haloRFIDStatus', this.statusRFID ? 'On' : 'Off'),
        this.logMessage('trace', `Capability "haloRFIDStatus" updated to: ${this.statusRFID ? 'On' : 'Off'}`),

        // Update and log capability for RFID button status
        this.setCapabilityValue('haloRFIDButton', this.statusRFID),
        this.logMessage('trace', `Capability "haloRFIDButton" updated to: ${this.statusRFID}`)
      ]);

    } catch (error) {
      // Log error if the API request fails
      this.logMessage('error', 'Error encountered during getChargerInfo:', error);
    } finally {
      this.logMessage('normal', 'Finished hourly info collection from ChargeAmps API');
    }
  }

}

module.exports = HALODevice;