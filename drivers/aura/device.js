"use strict";

const { Device } = require("homey");
const axios = require("axios");

/*******************************************************************************************************************************
 * AURADevice class extends the Device class and provides functionality for managing and interacting with AURA charging devices.
 *
 * This class handles:
 * - Controlling the charging process for both ports of the AURA device.
 * - Managing the LED ring and port-specific capabilities such as RFID and cable lock.
 * - Collecting, processing, and updating power consumption and charging data from the ChargeAmps API.
 *
 * @property {string|null} chargeAmpsToken - The token used for authenticating with the ChargeAmps API.
 * @property {string|null} chargeAmpsRefreshToken - The refresh token used for renewing the ChargeAmps API token.
 * @property {string} chargeAmpsId - The unique identifier for the AURA device retrieved during the pairing process.
 * @property {boolean} isGettingData - A flag that indicates whether data is currently being fetched from the ChargeAmps API.
 * @property {string|null} statusLEDring - The current status of the LED ring, fetched from the API.
 * @property {string} portAccess - Determines which ports are accessible on the device:
 *    - 'both': Both port 1 and port 2 are accessible and controllable.
 *    - 'port1': Only port 1 is accessible, port 2 capabilities are removed or disabled.
 *    - 'port2': Only port 2 is accessible, port 1 capabilities are removed or disabled.
 * @property {Object} aura - An object containing data for the two ports of the AURA device.
 * @property {Object} aura.port1 - Contains data related to port 1:
 *    - current: The current limit for port 1 (in amps).
 *    - chargerStatus: The status of the charger for port 1 (e.g., 'Charging', 'Connected', 'Available').
 *    - RFID: The RFID status for port 1 (true if RFID is enabled, false if disabled).
 *    - cableLock: The status of the cable lock for port 1 (true if the cable is locked, false otherwise).
 *    - nowConsumptionKwh: The current consumption in kWh for the active charging session.
 *    - chargingConsumptionKwh: The total charging consumption in kWh during the current charging session.
 *    - meterChargingKWH: The meter reading for the cumulative charging in kWh for port 1.
 *    - previousConsumptionKwh: The consumption in kWh from the previous charging session.
 * @property {Object} aura.port2 - Similar to `aura.port1`, this object holds data related to port 2:
 *    - current: The current limit for port 2 (in amps).
 *    - chargerStatus: The status of the charger for port 2.
 *    - RFID: The RFID status for port 2.
 *    - cableLock: The status of the cable lock for port 2.
 *    - nowConsumptionKwh: The current consumption in kWh for the active charging session.
 *    - chargingConsumptionKwh: The total charging consumption in kWh during the current charging session.
 *    - meterChargingKWH: The meter reading for cumulative charging in kWh for port 2.
 *    - previousConsumptionKwh: The consumption in kWh from the previous charging session.
 *
 * @method onInit - Initializes the AURA device:
 *    - Logs the initialization message.
 *    - Sets up variables like the API token, port access, and device ID.
 *    - Logs into the ChargeAmps API and starts loops for fetching data and renewing the token.
 * @method basicPreparation - Prepares the device by adding capabilities, registering capability listeners, and defining flow cards.
 *    - Dynamically adds or removes capabilities based on the `portAccess` setting.
 *    - Registers listeners for handling changes in on/off status, RFID, cable lock, and LED ring controls.
 * @method loginCA - Logs into the ChargeAmps API using user credentials and security key provided in Homey settings.
 *    - Handles the API authentication and retrieves tokens for further requests.
 * @method renewToken - Asynchronously renews the ChargeAmps API token using the current token and refresh token.
 *    - Updates the token and schedules the next renewal.
 * @method getCAdataLoop - Continuously fetches charging data from the ChargeAmps API in a loop.
 *    - Handles the dynamic adjustment of timeouts between each fetch based on the time taken for the last request.
 * @method getLightinfo - Retrieves the LED ring light status from the ChargeAmps API and updates the device's capabilities.
 *    - Sets the LED ring to 'Off' if `portAccess` is not set to 'both'.
 * @method getChargerInfo - Fetches and updates the charger settings for port 1 (e.g., current, charger mode, RFID, cable lock).
 *    - If `portAccess` is 'port1' or 'both', the settings for port 1 are fetched from the API.
 * @method getCharger2Info - Fetches and updates the charger settings for port 2 (e.g., current, charger mode, RFID, cable lock).
 *    - Similar to `getChargerInfo`, but for port 2.
 * @method getChargingInfo - Retrieves and processes charging session data for port 1.
 *    - Updates power consumption capabilities (`measure_aura1`, `meter_aura1`), last charged session (`aura1LastCharged`), and more.
 * @method getChargingInfo2 - Similar to `getChargingInfo`, this method retrieves and processes charging data for port 2.
 *    - Also calculates combined totals for both ports when `portAccess` is 'both'.
 *
 * The class structure allows full control over both ports of the AURA device, as well as LED ring management and dynamic power consumption tracking.
 **************************************************************************************************************************************/

class AURADevice extends Device {

  /***********************************************************************************************************
   * Initializes the AURA device.
   * 
   * This method performs the following actions:
   * - Logs the initialization message.
   * - Defines and initializes various variables related to the device and its ports.
   * - Logs the port access setting and the retrieved device ID for debugging purposes.
   * - Updates the device settings to reflect the correct port access.
   * - Calls a module to check capabilities, set capability listeners, and define flow cards.
   * - Attempts to log in to the ChargeAmps API using credentials from Homey settings.
   * - Initiates a loop to continuously fetch data from ChargeAmps.
   * - Sets up a loop to renew the API token, with the first run occurring after 30 minutes.
   **********************************************************************************************************/
  async onInit() {
    this.logMessage('normal', 'AURA Device has been initialized');

    /* Define variables */
    this.chargeAmpsToken = null;
    this.chargeAmpsRefreshToken = null;
    this.chargeAmpsId = this.getData().id; // Retrieve the specific device ID passed from the pairing process
    this.isGettingData = false;
    this.statusLEDring = null;
    this.portAccess = this.getSetting('portAccess') || 'both';
    this.debugLevel = this.getSetting('debugLevel') || 'normal';
    this.aura = {
      port1: {
        current: null,
        chargerStatus: null,
        RFID: null,
        cableLock: null,
        nowConsumptionKwh: null,
        chargingConsumptionKwh: null,
        meterChargingKWH: null,
        previousConsumptionKwh: null,
      },
      port2: {
        current: null,
        chargerStatus: null,
        RFID: null,
        cableLock: null,
        nowConsumptionKwh: null,
        chargingConsumptionKwh: null,
        meterChargingKWH: null,
        previousConsumptionKwh: null,
      },
    };

    this.logMessage('normal', `Port access initialized as: ${this.portAccess}`);
    this.logMessage('normal', `chargeAmpsId retrieved: ${this.chargeAmpsId}`);

    // Call module 'basicPreparation to Check Capabilities, set Capability Listeners and define Flow Cards
    await this.basicPreparation();

    // Login to ChargeAmps API
    try {
      this.logMessage('trace', 'Attempting to log in to ChargeAmps API...');
      await this.loginCA(this.homey.settings.get('email'), this.homey.settings.get('password'), this.homey.settings.get('APIkey'));
      this.logMessage('trace', 'Login to ChargeAmps API successful.');
    } catch (error) {
      this.logMessage('error', 'Login failed:', error);
      throw new Error('Failed to log in to ChargeAmps API');
    }

    // Initial collection of basic data from ChargeAmps
    await this.getHourlyData();

    // Initiate the get ChargeAmps Data Loop
    this.getCAdataLoop();

    // Initiate Renew Token Loop (first run after 30min)
    this.logMessage('trace', 'Setting up token renewal loop (first run in 30 minutes)...');
    setTimeout(() => this.renewTokenLoop(), 1000 * 60 * 30); // 30 minutes delay for the first execution
  }

  /*******************************************
  * Central log function based on debug level
  *******************************************/
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

  // *********************************************************************************************************
  //      HANDLES CAPABILITIES AND FLOW CARDS
  /***********************************************************************************************************
   * Performs basic preparation for capabilities and flow cards.
   * 
   * This method initializes and configures capabilities and flow cards for the device.
   * It adds all necessary capabilities, removes capabilities based on port access,
   * registers capability listeners, and sets up flow card actions and conditions.
   **********************************************************************************************************/
  async basicPreparation() {
    this.logMessage('normal', 'Starting basic preparation for capabilities and flow cards...');

    // Check and remove old Status capabilities if they exist
    const oldCapabilities = ['measure_power', 'meter_power', 'aura1onoffStatus', 'aura2onoffStatus', 'aura1CarConnected', 'aura2CarConnected', 'aura1CurrentLimit', 'aura2CurrentLimit', 'aura1LastCharged', 'aura2LastCharged', 'aura1NowCharged', 'aura2NowCharged', 'auraFW', 'auraVersion', 'aura1RFIDStatus', 'aura2RFIDStatus', 'aura1CableLockStatus', 'aura2CableLockStatus', 'auraLEDringStatus'];

    for (const capability of oldCapabilities) {
      if (this.hasCapability(capability)) {
        this.logMessage('trace', `Removing old capability: ${capability}`);
        await this.removeCapability(capability);
      }
    }

    // Ceck and add all capabilities if they do not exist
    const allCapabilities = [
      'aura1onoffButton',
      'aura2onoffButton',
      'measure_aura1',
      'meter_aura1',
      'measure_aura2',
      'meter_aura2',
      'measure_both',
      'meter_both',
      'aura1onoffStatus',
      'aura2onoffStatus',
      'aura1CarConnected',
      'aura2CarConnected',
      'aura1CurrentLimit',
      'aura2CurrentLimit',
      'aura1LastCharged',
      'aura2LastCharged',
      'aura1NowCharged',
      'aura2NowCharged',
      'auraFW',
      'auraVersion',
      'aura1RFIDStatus',
      'aura2RFIDStatus',
      'aura1CableLockStatus',
      'aura2CableLockStatus',
      'aura1RFIDButton',
      'aura2RFIDButton',
      'aura1CableLockButton',
      'aura2CableLockButton',
      'auraLEDringButton',
      'auraLEDringStatus'
    ];

    for (const capability of allCapabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

    // Remove un-needed Capabilities based on portAccess
    if (this.portAccess === 'port1') {
      const removePort1Capabilities = [
        'aura2onoffButton',
        'measure_aura2',
        'measure_both',
        'meter_aura2',
        'meter_both',
        'aura2onoffStatus',
        'aura2CarConnected',
        'aura2CurrentLimit',
        'aura2LastCharged',
        'aura2NowCharged',
        'aura2RFIDStatus',
        'aura2CableLockStatus',
        'aura2RFIDButton',
        'aura2CableLockButton',
        'auraLEDringButton',
        'auraLEDringStatus'
      ];

      for (const capability of removePort1Capabilities) {
        if (this.hasCapability(capability)) {
          await this.removeCapability(capability);
        }
      }
    } else if (this.portAccess === 'port2') {
      const removePort2Capabilities = [
        'aura1onoffButton',
        'measure_aura1',
        'measure_both',
        'meter_aura1',
        'meter_both',
        'aura1onoffStatus',
        'aura1CarConnected',
        'aura1CurrentLimit',
        'aura1LastCharged',
        'aura1NowCharged',
        'aura1RFIDStatus',
        'aura1CableLockStatus',
        'aura1RFIDButton',
        'aura1CableLockButton',
        'auraLEDringButton',
        'auraLEDringStatus'
      ];

      for (const capability of removePort2Capabilities) {
        if (this.hasCapability(capability)) {
          await this.removeCapability(capability);
        }
      }
    }

    // Register capability listeners based on portAccess
    this.logMessage('normal', 'Registering capability listeners...');
    if (this.portAccess === 'both' || this.portAccess === 'port1') {
      this.registerCapabilityListener('aura1onoffButton', this.onOnOff1CapabilityChange.bind(this));
      this.registerCapabilityListener('aura1RFIDButton', this.onaura1RFIDButton.bind(this));
      this.registerCapabilityListener('aura1CableLockButton', this.onaura1CableLockButton.bind(this));
    };

    if (this.portAccess === 'both' || this.portAccess === 'port2') {
      this.registerCapabilityListener('aura2onoffButton', this.onOnOff2CapabilityChange.bind(this));
      this.registerCapabilityListener('aura2RFIDButton', this.onaura2RFIDButton.bind(this));
      this.registerCapabilityListener('aura2CableLockButton', this.onaura2CableLockButton.bind(this));
    };

    if (this.portAccess === 'both') {
      this.registerCapabilityListener('auraLEDringButton', this.onAuraLEDringButton.bind(this));
    };

    this.logMessage('normal', 'Registering flow cards for controlling actions and conditions...');
    // Define variabled for flow cards
    let cardActionCurrent, cardActionRFIDOn1, cardActionRFIDOff1, cardActionCableLockOn1, cardActionCableLockOff1,
      cardActionCharger1on, cardActionCharger1off, cardConditionCharger1on, cardConditionCharger1off,
      cardConditionCarConnected, cardConditionCarIsCharging, cardConditionRFID1, cardConditionCableLock1;
    let cardActionCurrent2, cardActionRFIDOn2, cardActionRFIDOff2, cardActionCableLockOn2, cardActionCableLockOff2,
      cardActionCharger2on, cardActionCharger2off, cardConditionCharger2on, cardConditionCharger2off,
      cardConditionCarConnected2, cardConditionCarIsCharging2, cardConditionRFID2, cardConditionCableLock2;
    let cardActionLEDring;

    // These flow cards enable users to control and automate various aspects of Charger 1 through the Homey app.
    // They include actions like changing current, turning RFID on/off, locking/unlocking the cable, and turning the charger on/off.
    // The condition cards allow Homey to evaluate the current status of Charger 1 before performing certain automations.

    // Action Cards for controlling Charger 1
    if (this.portAccess === 'both' || this.portAccess === 'port1') {
      cardActionCurrent = this.homey.flow.getActionCard('aura1-changecurrent');
      // This action allows the user to change the charging current limit for Charger 1. It triggers the update of the current limit based on the user's input through Homey flows.
      cardActionRFIDOn1 = this.homey.flow.getActionCard('aura1-turn-on-RFID');
      // Turns on RFID for Charger 1. This flow card is used in automation flows where the user wants to enable RFID access for charging.   
      cardActionRFIDOff1 = this.homey.flow.getActionCard('aura1-turn-off-RFID');
      // Turns off RFID for Charger 1. It disables RFID access for charging, useful for security purposes in automation flows.    
      cardActionCableLockOn1 = this.homey.flow.getActionCard('aura1-turn-on-CableLock');
      // Locks the cable for Charger 1. Can be used in automations where the user wants to ensure that the cable is securely locked when the car is connected.    
      cardActionCableLockOff1 = this.homey.flow.getActionCard('aura1-turn-off-CableLock');
      // Unlocks the cable for Charger 1. This flow card is used when the user wants to remotely unlock the cable in their Homey automation.   
      cardActionCharger1on = this.homey.flow.getActionCard('aura1-charger-on');
      // Turns on Charger 1. Used in Homey flows to start charging on Port 1 automatically based on certain conditions, such as when a car is connected.    
      cardActionCharger1off = this.homey.flow.getActionCard('aura1-charger-off');
      // Turns off Charger 1. Used in Homey flows to stop charging on Port 1, useful in automations where charging needs to be stopped based on certain conditions.    

      // Condition Cards for checking Charger 1 status
      cardConditionCharger1on = this.homey.flow.getConditionCard('aura1-charger-status');
      // Checks if Charger 1 is ON. Can be used as a condition in Homey flows to check whether the charger is currently active before taking an action.    
      cardConditionCharger1off = this.homey.flow.getConditionCard('aura1-charger-status');
      // Checks if Charger 1 is OFF. This condition card can be used in flows to ensure that certain actions are only performed when the charger is off.    
      cardConditionCarConnected = this.homey.flow.getConditionCard('aura1-carIsConnected');
      // Checks if a car is connected to Charger 1. Useful in flows where an action should only be performed if a car is physically connected to Port 1.    
      cardConditionCarIsCharging = this.homey.flow.getConditionCard('aura1-carIsCharging');
      // Checks if the car connected to Charger 1 is currently charging. Can be used to trigger automations only when charging is in progress.
      cardConditionRFID1 = this.homey.flow.getConditionCard('aura1-RFIDStatus');
      // Checks the RFID status for Charger 1. Allows flows to be triggered based on whether RFID is enabled or disabled for Port 1.    
      cardConditionCableLock1 = this.homey.flow.getConditionCard('aura1-CableLockStatus');
      // Checks the cable lock status for Charger 1. This condition card is useful for automations that depend on the cable lock being either engaged or disengaged.
    }

    // Registering flow cards for controlling Charger 2 actions and conditions...
    if (this.portAccess === 'both' || this.portAccess === 'port2') {
      cardActionCurrent2 = this.homey.flow.getActionCard('aura2-changecurrent');
      // Changes the charging current for Charger 2. This action card lets users set the current limit for Port 2 via Homey flows.
      cardActionRFIDOn2 = this.homey.flow.getActionCard('aura2-turn-on-RFID');
      // Turns on RFID for Charger 2, enabling charging authorization through RFID tags.
      cardActionRFIDOff2 = this.homey.flow.getActionCard('aura2-turn-off-RFID');
      // Turns off RFID for Charger 2, disabling RFID-based charging authorization.
      cardActionCableLockOn2 = this.homey.flow.getActionCard('aura2-turn-on-CableLock');
      // Locks the cable for Charger 2. Can be triggered in automation to secure the charging cable on Port 2.
      cardActionCableLockOff2 = this.homey.flow.getActionCard('aura2-turn-off-CableLock');
      // Unlocks the cable for Charger 2. Used in flows where the user wants to remotely unlock the charging cable.
      cardActionCharger2on = this.homey.flow.getActionCard('aura2-charger-on');
      // Turns on Charger 2. Automates starting the charging process on Port 2.
      cardActionCharger2off = this.homey.flow.getActionCard('aura2-charger-off');
      // Turns off Charger 2. Stops the charging process for Port 2.

      // Condition Cards for Charger 2
      cardConditionCharger2on = this.homey.flow.getConditionCard('aura2-charger-status');
      // Checks if Charger 2 is ON.
      cardConditionCharger2off = this.homey.flow.getConditionCard('aura2-charger-status');
      // Checks if Charger 2 is OFF.
      cardConditionCarConnected2 = this.homey.flow.getConditionCard('aura2-carIsConnected');
      // Checks if a car is connected to Charger 2.
      cardConditionCarIsCharging2 = this.homey.flow.getConditionCard('aura2-carIsCharging');
      // Checks if the car connected to Charger 2 is currently charging.
      cardConditionRFID2 = this.homey.flow.getConditionCard('aura2-RFIDStatus');
      // Checks the RFID status for Charger 2.
      cardConditionCableLock2 = this.homey.flow.getConditionCard('aura2-CableLockStatus');
      // Checks the cable lock status for Charger 2.
    }

    // Registering flow cards for controlling the LED ring...
    if (this.portAccess === 'both') {
      cardActionLEDring = this.homey.flow.getActionCard('aura-change-led-ring');
    }

    // *******************************************************
    //             Register flow card listeners
    // *******************************************************
    if (cardActionCurrent) {
      cardActionCurrent.registerRunListener(async (args) => {
        this.logMessage('normal', 'cardActionCurrent triggered with args:', args);
        if (this.portAccess === 'both' || this.portAccess === 'port1') {
          const { Current } = args;
          this.aura.port1.current = Current;

          try {
            await Promise.all([
              this.setSettings({ settingsCurrentLimit: Current }),
              this.setCharger1Settings(Current, this.aura.port1.RFID, this.aura.port1.chargerStatus, this.aura.port1.cableLock),
              this.setCapabilityValue('aura1CurrentLimit', Current),
            ]);
            this.logMessage('trace', 'Current limit for Charger 1 has been set to:', Current);
          } catch (error) {
            this.logMessage('error', 'Error while setting current for Charger 1:', error);
          }
        } else {
          this.logMessage('trace', 'Action not allowed: portAccess does not allow control of Charger 1.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCurrent is undefined or null.');
    }

    if (cardActionCurrent2) {
      cardActionCurrent2.registerRunListener(async (args) => {
        this.logMessage('normal', 'cardActionCurrent2 triggered with args:', args);
        if (this.portAccess === 'both' || this.portAccess === 'port2') {
          const { Current } = args;
          this.aura.port2.current = Current;

          try {
            await Promise.all([
              this.setSettings({ settingsCurrentLimit2: Current }),
              this.setCharger2Settings(Current, this.aura.port2.RFID, this.aura.port2.chargerStatus, this.aura.port2.cableLock),
              this.setCapabilityValue('aura2CurrentLimit', Current),
            ]);
            this.logMessage('trace', 'Current limit for Charger 2 has been set to:', Current);
          } catch (error) {
            this.logMessage('error', 'Error while setting current for Charger 2:', error);
          }
        } else {
          this.logMessage('trace', 'Action not allowed: portAccess does not allow control of Charger 2.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCurrent2 is undefined or null.');
    }

    if (cardActionLEDring) {
      cardActionLEDring.registerRunListener(async (args) => {
        this.logMessage('normal', 'cardActionLEDring triggered with args:', args);
        if (this.portAccess === 'both') {
          const { LEDring } = args;
          this.statusLEDring = LEDring;

          try {
            await Promise.all([
              this.setLightAndDimmer(LEDring),
              this.setCapabilityValue('auraLEDringStatus', LEDring),
            ]);
            this.logMessage('trace', 'LED Ring has been set to:', LEDring);
          } catch (error) {
            this.logMessage('error', 'Error while setting LED ring:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess is not "both".');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionLEDring is undefined or null.');
    }

    if (cardActionRFIDOn1) {
      cardActionRFIDOn1.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionRFIDOn1 triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port1') {
          const cardTriggerRFIDOn = this.homey.flow.getDeviceTriggerCard('aura1-RFID-switched-on');
          cardTriggerRFIDOn.trigger(this, {}, {}).catch(this.error);
          this.aura.port1.RFID = true;

          try {
            await Promise.all([
              this.setCharger1Settings(this.aura.port1.current, true, this.aura.port1.chargerStatus, this.aura.port1.cableLock),
              this.setCapabilityValue('aura1RFIDStatus', 'On'),
              this.setCapabilityValue('aura1RFIDButton', true),
            ]);
            this.logMessage('trace', 'RFID for Charger 1 has been turned on.');
          } catch (error) {
            this.logMessage('error', 'Error while turning on RFID for Charger 1:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of RFID for Charger 1.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionRFIDOn1 is undefined or null.');
    }

    if (cardActionRFIDOff1) {
      cardActionRFIDOff1.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionRFIDOff1 triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port1') {
          const cardTriggerRFIDOff = this.homey.flow.getDeviceTriggerCard('aura1-RFID-switched-off');
          cardTriggerRFIDOff.trigger(this, {}, {}).catch(this.error);
          this.aura.port1.RFID = false;

          try {
            await Promise.all([
              this.setCharger1Settings(this.aura.port1.current, false, this.aura.port1.chargerStatus, this.aura.port1.cableLock),
              this.setCapabilityValue('aura1RFIDStatus', 'Off'),
              this.setCapabilityValue('aura1RFIDButton', false),
            ]);
            this.logMessage('trace', 'RFID for Charger 1 has been turned off.');
          } catch (error) {
            this.logMessage('error', 'Error while turning off RFID for Charger 1:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of RFID for Charger 1.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionRFIDOff1 is undefined or null.');
    }

    if (cardActionCableLockOn1) {
      cardActionCableLockOn1.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionCableLockOn1 triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port1') {
          const cardTriggerCableLockOn = this.homey.flow.getDeviceTriggerCard('aura1-CableLock-switched-on');
          cardTriggerCableLockOn.trigger(this, {}, {}).catch(this.error);
          this.aura.port1.cableLock = true;

          try {
            await Promise.all([
              this.setCharger1Settings(this.aura.port1.current, this.aura.port1.RFID, this.aura.port1.chargerStatus, true),
              this.setCapabilityValue('aura1CableLockStatus', 'On'),
              this.setCapabilityValue('aura1CableLockButton', true),
            ]);
            this.logMessage('trace', 'Cable lock for Charger 1 has been turned on.');
          } catch (error) {
            this.logMessage('error', 'Error while turning on Cable Lock for Charger 1:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Cable Lock for Charger 1.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCableLockOn1 is undefined or null.');
    }

    if (cardActionCableLockOff1) {
      cardActionCableLockOff1.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionCableLockOff1 triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port1') {
          const cardTriggerCableLockOff = this.homey.flow.getDeviceTriggerCard('aura1-CableLock-switched-off');
          cardTriggerCableLockOff.trigger(this, {}, {}).catch(this.error);
          this.aura.port1.cableLock = false;

          try {
            await Promise.all([
              this.setCharger1Settings(this.aura.port1.current, this.aura.port1.RFID, this.aura.port1.chargerStatus, false),
              this.setCapabilityValue('aura1CableLockStatus', 'Off'),
              this.setCapabilityValue('aura1CableLockButton', false),
            ]);
            this.logMessage('trace', 'Cable lock for Charger 1 has been turned off.');
          } catch (error) {
            this.logMessage('error', 'Error while turning off Cable Lock for Charger 1:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Cable Lock for Charger 1.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCableLockOff1 is undefined or null.');
    }

    if (cardActionRFIDOn2) {
      cardActionRFIDOn2.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionRFIDOn2 triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port2') {
          const cardTriggerRFIDOn = this.homey.flow.getDeviceTriggerCard('aura2-RFID-switched-on');
          if (cardTriggerRFIDOn) {
            cardTriggerRFIDOn.trigger(this, {}, {}).catch(this.error);
          } else {
            this.logMessage('error', 'Error: cardTriggerRFIDOn is undefined or null.');
          }

          this.aura.port2.RFID = true;

          try {
            await Promise.all([
              this.setCharger2Settings(this.aura.port2.current, true, this.aura.port2.chargerStatus, this.aura.port2.cableLock),
              this.setCapabilityValue('aura2RFIDStatus', 'On'),
              this.setCapabilityValue('aura2RFIDButton', true),
            ]);
            this.logMessage('trace', 'RFID for Charger 2 has been turned on.');
          } catch (error) {
            this.logMessage('error', 'Error while turning on RFID for Charger 2:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of RFID for Charger 2.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionRFIDOn2 is undefined or null.');
    }

    if (cardActionRFIDOff2) {
      cardActionRFIDOff2.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionRFIDOff2 triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port2') {
          const cardTriggerRFIDOff = this.homey.flow.getDeviceTriggerCard('aura2-RFID-switched-off');

          if (cardTriggerRFIDOff) {
            cardTriggerRFIDOff.trigger(this, {}, {}).catch(this.error);
          } else {
            this.logMessage('error', 'Error: cardTriggerRFIDOff is undefined or null.');
          }

          this.aura.port2.RFID = false;

          try {
            await Promise.all([
              this.setCharger2Settings(this.aura.port2.current, false, this.aura.port2.chargerStatus, this.aura.port2.cableLock),
              this.setCapabilityValue('aura2RFIDStatus', 'Off'),
              this.setCapabilityValue('aura2RFIDButton', false),
            ]);
            this.logMessage('trace', 'RFID for Charger 2 has been turned off.');
          } catch (error) {
            this.logMessage('error', 'Error while turning off RFID for Charger 2:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of RFID for Charger 2.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionRFIDOff2 is undefined or null.');
    }

    if (cardActionCableLockOn2) {
      cardActionCableLockOn2.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionCableLockOn2 triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port2') {
          const cardTriggerCableLockOn = this.homey.flow.getDeviceTriggerCard('aura2-CableLock-switched-on');

          if (cardTriggerCableLockOn) {
            cardTriggerCableLockOn.trigger(this, {}, {}).catch(this.error);
          } else {
            this.logMessage('error', 'Error: cardTriggerCableLockOn is undefined or null.');
          }

          this.aura.port2.cableLock = true;

          try {
            await Promise.all([
              this.setCharger2Settings(this.aura.port2.current, this.aura.port2.RFID, this.aura.port2.chargerStatus, true),
              this.setCapabilityValue('aura2CableLockStatus', 'On'),
              this.setCapabilityValue('aura2CableLockButton', true),
            ]);
            this.logMessage('trace', 'Cable lock for Charger 2 has been turned on.');
          } catch (error) {
            this.logMessage('error', 'Error while turning on Cable Lock for Charger 2:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Cable Lock for Charger 2.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCableLockOn2 is undefined or null.');
    }

    if (cardActionCableLockOff2) {
      cardActionCableLockOff2.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionCableLockOff2 triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port2') {
          const cardTriggerCableLockOff = this.homey.flow.getDeviceTriggerCard('aura2-CableLock-switched-off');

          if (cardTriggerCableLockOff) {
            cardTriggerCableLockOff.trigger(this, {}, {}).catch(this.error);
          } else {
            this.logMessage('error', 'Error: cardTriggerCableLockOff is undefined or null.');
          }

          this.aura.port2.cableLock = false;

          try {
            await Promise.all([
              this.setCharger2Settings(this.aura.port2.current, this.aura.port2.RFID, this.aura.port2.chargerStatus, false),
              this.setCapabilityValue('aura2CableLockStatus', 'Off'),
              this.setCapabilityValue('aura2CableLockButton', false),
            ]);
            this.logMessage('trace', 'Cable lock for Charger 2 has been turned off.');
          } catch (error) {
            this.logMessage('error', 'Error while turning off Cable Lock for Charger 2:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Cable Lock for Charger 2.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCableLockOff2 is undefined or null.');
    }

    if (cardActionCharger1on) {
      cardActionCharger1on.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionCharger1on triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port1') {
          const cardTriggerCharger1On = this.homey.flow.getDeviceTriggerCard('aura1-switched-on');

          if (cardTriggerCharger1On) {
            cardTriggerCharger1On.trigger(this, {}, {}).catch(this.error);
          } else {
            this.logMessage('error', 'Error: cardTriggerCharger1On is undefined or null.');
          }

          try {
            await Promise.all([
              this.setCharger1Settings(this.aura.port1.current, this.aura.port1.RFID, 'On', this.aura.port1.cableLock),
              this.setCapabilityValue('aura1onoffStatus', 'On'),
              this.setCapabilityValue('aura1onoffButton', true),
            ]);
            this.logMessage('trace', 'Charger 1 has been turned on.');
          } catch (error) {
            this.logMessage('error', 'Error while turning on Charger 1:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Charger 1.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCharger1on is undefined or null.');
    }

    if (cardActionCharger1off) {
      cardActionCharger1off.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionCharger1off triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port1') {
          const cardTriggerCharger1Off = this.homey.flow.getDeviceTriggerCard('aura1-switched-off');

          if (cardTriggerCharger1Off) {
            cardTriggerCharger1Off.trigger(this, {}, {}).catch(this.error);
          } else {
            this.logMessage('error', 'Error: cardTriggerCharger1Off is undefined or null.');
          }

          try {
            await Promise.all([
              this.setCharger1Settings(this.aura.port1.current, this.aura.port1.RFID, 'Off', this.aura.port1.cableLock),
              this.setCapabilityValue('aura1onoffStatus', 'Off'),
              this.setCapabilityValue('aura1onoffButton', false),
            ]);
            this.logMessage('trace', 'Charger 1 has been turned off.');
          } catch (error) {
            this.logMessage('error', 'Error while turning off Charger 1:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Charger 1.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCharger1off is undefined or null.');
    }

    if (cardActionCharger2on) {
      cardActionCharger2on.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionCharger2on triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port2') {
          const cardTriggerCharger2On = this.homey.flow.getDeviceTriggerCard('aura2-switched-on');

          // validate cardTriggerCharger2On
          if (cardTriggerCharger2On) {
            cardTriggerCharger2On.trigger(this, {}, {}).catch(this.error);
          } else {
            this.logMessage('error', 'Error: cardTriggerCharger2On is undefined or null.');
          }

          try {
            await Promise.all([
              this.setCharger2Settings(this.aura.port2.current, this.aura.port2.RFID, 'On', this.aura.port2.cableLock),
              this.setCapabilityValue('aura2onoffStatus', 'On'),
              this.setCapabilityValue('aura2onoffButton', true),
            ]);
            this.logMessage('trace', 'Charger 2 has been turned on.');
          } catch (error) {
            this.logMessage('error', 'Error while turning on Charger 2:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Charger 2.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCharger2on is undefined or null.');
    }

    if (cardActionCharger2off) {
      cardActionCharger2off.registerRunListener(async () => {
        this.logMessage('normal', 'cardActionCharger2off triggered');
        if (this.portAccess === 'both' || this.portAccess === 'port2') {
          const cardTriggerCharger2Off = this.homey.flow.getDeviceTriggerCard('aura2-switched-off');

          // validate cardTriggerCharger2Off
          if (cardTriggerCharger2Off) {
            cardTriggerCharger2Off.trigger(this, {}, {}).catch(this.error);
          } else {
            this.logMessage('error', 'Error: cardTriggerCharger2Off is undefined or null.');
          }

          try {
            await Promise.all([
              this.setCharger2Settings(this.aura.port2.current, this.aura.port2.RFID, 'Off', this.aura.port2.cableLock),
              this.setCapabilityValue('aura2onoffStatus', 'Off'),
              this.setCapabilityValue('aura2onoffButton', false),
            ]);
            this.logMessage('trace', 'Charger 2 has been turned off.');
          } catch (error) {
            this.logMessage('error', 'Error while turning off Charger 2:', error);
          }
        } else {
          this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Charger 2.');
        }
      });
    } else {
      this.logMessage('error', 'Error: cardActionCharger2off is undefined or null.');
    }

    if (cardConditionCarConnected) {
      cardConditionCarConnected.registerRunListener(() => {
        this.logMessage('normal', 'Checking if car is connected to Port 1...');

        // check if portAccess is correct for Port 1
        if (this.portAccess === 'both' || this.portAccess === 'port1') {

          // validate that capability 'aura1CarConnected' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura1CarConnected');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isConnected = capabilityValue === 'Connected';
            this.logMessage('trace', `Car connected status for Port 1: ${isConnected}`);
            return isConnected;
          } else {
            this.logMessage('error', 'Error: Capability value for aura1CarConnected is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 1 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCarConnected is undefined or null.');
    }

    if (cardConditionCarConnected2) {
      cardConditionCarConnected2.registerRunListener(() => {
        this.logMessage('normal', 'Checking if car is connected to Port 2...');

        // check if portAccess is correct for Port 2
        if (this.portAccess === 'both' || this.portAccess === 'port2') {

          // validate that capability 'aura2CarConnected' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura2CarConnected');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isConnected = capabilityValue === 'Connected';
            this.logMessage('trace', `Car connected status for Port 2: ${isConnected}`);
            return isConnected;
          } else {
            this.logMessage('error', 'Error: Capability value for aura2CarConnected is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 2 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCarConnected2 is undefined or null.');
    }

    if (cardConditionCarIsCharging) {
      cardConditionCarIsCharging.registerRunListener(() => {
        this.logMessage('normal', 'Checking if car is charging on Port 1...');

        // check if portAccess is correct for Port 1
        if (this.portAccess === 'both' || this.portAccess === 'port1') {

          // validate that capability 'aura1CarConnected' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura1CarConnected');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isCharging = capabilityValue === 'Charging';
            this.logMessage('trace', `Car charging status for Port 1: ${isCharging}`);
            return isCharging;
          } else {
            this.logMessage('error', 'Error: Capability value for aura1CarConnected is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 1 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCarIsCharging is undefined or null.');
    }

    if (cardConditionCarIsCharging2) {
      cardConditionCarIsCharging2.registerRunListener(() => {
        this.logMessage('normal', 'Checking if car is charging on Port 2...');

        // check if portAccess is correct for Port 2
        if (this.portAccess === 'both' || this.portAccess === 'port2') {

          // validate that capability 'aura2CarConnected' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura2CarConnected');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isCharging = capabilityValue === 'Charging';
            this.logMessage('trace', `Car charging status for Port 2: ${isCharging}`);
            return isCharging;
          } else {
            this.logMessage('error', 'Error: Capability value for aura2CarConnected is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 2 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCarIsCharging2 is undefined or null.');
    }

    if (cardConditionCharger1on) {
      cardConditionCharger1on.registerRunListener(() => {
        this.logMessage('normal', 'Checking if Charger 1 is ON...');

        // check if portAccess is correct for Port 1
        if (this.portAccess === 'both' || this.portAccess === 'port1') {

          // validate that capability 'aura1onoffStatus' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura1onoffStatus');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isOn = capabilityValue === 'On';
            this.logMessage('trace', `Charger 1 status: ${isOn}`);
            return isOn;
          } else {
            this.logMessage('error', 'Error: Capability value for aura1onoffStatus is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 1 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCharger1on is undefined or null.');
    }

    if (cardConditionCharger1off) {
      cardConditionCharger1off.registerRunListener(() => {
        this.logMessage('normal', 'Checking if Charger 1 is OFF...');

        // check if portAccess is correct for Port 1
        if (this.portAccess === 'both' || this.portAccess === 'port1') {

          //validate that capability 'aura1onoffStatus' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura1onoffStatus');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isOff = capabilityValue === 'Off';
            this.logMessage('trace', `Charger 1 status: ${isOff}`);
            return isOff;
          } else {
            this.logMessage('error', 'Error: Capability value for aura1onoffStatus is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 1 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCharger1off is undefined or null.');
    }

    if (cardConditionCharger2on) {
      cardConditionCharger2on.registerRunListener(() => {
        this.logMessage('normal', 'Checking if Charger 2 is ON...');

        // check if portAccess is correct for Port 2
        if (this.portAccess === 'both' || this.portAccess === 'port2') {

          // validate that capability 'aura2onoffStatus' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura2onoffStatus');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isOn = capabilityValue === 'On';
            this.logMessage('trace', `Charger 2 status: ${isOn}`);
            return isOn;
          } else {
            this.logMessage('error', 'Error: Capability value for aura2onoffStatus is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 2 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCharger2on is undefined or null.');
    }

    if (cardConditionCharger2off) {
      cardConditionCharger2off.registerRunListener(() => {
        this.logMessage('normal', 'Checking if Charger 2 is OFF...');

        // check if portAccess is correct for Port 2
        if (this.portAccess === 'both' || this.portAccess === 'port2') {

          //validate that capability 'aura2onoffStatus' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura2onoffStatus');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isOff = capabilityValue === 'Off';
            this.logMessage('trace', `Charger 2 status: ${isOff}`);
            return isOff;
          } else {
            this.logMessage('error', 'Error: Capability value for aura2onoffStatus is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 2 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCharger2off is undefined or null.');
    }

    if (cardConditionRFID1) {
      cardConditionRFID1.registerRunListener(() => {
        this.logMessage('normal', 'Checking if RFID 1 is ON...');

        // check if portAccess is correct for Port 1
        if (this.portAccess === 'both' || this.portAccess === 'port1') {

          // validate that capability 'aura1RFIDStatus' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura1RFIDStatus');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isRFIDOn = capabilityValue === 'On';
            this.logMessage('trace', `RFID 1 status: ${isRFIDOn}`);
            return isRFIDOn;
          } else {
            this.logMessage('error', 'Error: Capability value for aura1RFIDStatus is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 1 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionRFID1 is undefined or null.');
    }

    if (cardConditionRFID2) {
      cardConditionRFID2.registerRunListener(() => {
        this.logMessage('normal', 'Checking if RFID 2 is ON...');

        // check if portAccess is correct for Port 2
        if (this.portAccess === 'both' || this.portAccess === 'port2') {

          // validate that capability 'aura2RFIDStatus' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura2RFIDStatus');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isRFIDOn = capabilityValue === 'On';
            this.logMessage('trace', `RFID 2 status: ${isRFIDOn}`);
            return isRFIDOn;
          } else {
            this.logMessage('error', 'Error: Capability value for aura2RFIDStatus is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 2 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionRFID2 is undefined or null.');
    }

    if (cardConditionCableLock1) {
      cardConditionCableLock1.registerRunListener(() => {
        this.logMessage('normal', 'Checking if Cable Lock 1 is ON...');

        // check if portAccess is correct for Port 1
        if (this.portAccess === 'both' || this.portAccess === 'port1') {

          // validate that capability 'aura1CableLockStatus' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura1CableLockStatus');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isCableLockOn = capabilityValue === 'On';
            this.logMessage('trace', `Cable Lock 1 status: ${isCableLockOn}`);
            return isCableLockOn;
          } else {
            this.logMessage('error', 'Error: Capability value for aura1CableLockStatus is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 1 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCableLock1 is undefined or null.');
    }

    if (cardConditionCableLock2) {
      cardConditionCableLock2.registerRunListener(() => {
        this.logMessage('normal', 'Checking if Cable Lock 2 is ON...');

        // check if portAccess is correct for Port 2
        if (this.portAccess === 'both' || this.portAccess === 'port2') {

          // validate that capability 'aura2CableLockStatus' exists before fetching the value
          const capabilityValue = this.getCapabilityValue('aura2CableLockStatus');
          if (capabilityValue !== null && capabilityValue !== undefined) {
            const isCableLockOn = capabilityValue === 'On';
            this.logMessage('trace', `Cable Lock 2 status: ${isCableLockOn}`);
            return isCableLockOn;
          } else {
            this.logMessage('error', 'Error: Capability value for aura2CableLockStatus is undefined or null.');
            return false;
          }
        }

        this.logMessage('normal', 'Access denied: Port 2 control is not available.');
        return false;
      });
    } else {
      this.logMessage('error', 'Error: cardConditionCableLock2 is undefined or null.');
    }
  }

  // *********************************************************************************************************
  // MODULES TO HANDLE TOGGLE & BUTTONS
  /***********************************************************************************************************
   * Handles the capability change for On/Off functionality of Charger 1.
   * 
   * @async
   * @param {boolean} value - The new value for the On/Off capability.
   * @returns {Promise<void>}
   * 
   * @description
   * This method is triggered when the On/Off capability of Charger 1 changes. It checks if the port access
   * allows control of Charger 1, sets the charger settings accordingly, updates the capability value, and
   * triggers the appropriate flow card based on the new status.
   * 
   * @throws {Error} If an error occurs while toggling Charger 1.
   **********************************************************************************************************/
  async onOnOff1CapabilityChange(value) {
    this.logMessage('normal', 'onOnOff1CapabilityChange triggered with value:', value);

    if (this.portAccess === 'both' || this.portAccess === 'port1') {
      const mode = value ? 1 : 0;
      const status = value ? 'On' : 'Off';

      this.logMessage('trace', `Setting Charger 1 to ${status} with mode: ${mode}`);

      try {
        await Promise.all([
          this.setCharger1Settings(this.aura.port1.current, this.aura.port1.RFID, mode, this.aura.port1.cableLock),
          this.setCapabilityValue('aura1onoffStatus', status)
        ]);

        this.aura.port1.chargerStatus = value;

        // Add trigger card besed on if the charger is on or off
        const cardTriggerCharger1 = this.homey.flow.getDeviceTriggerCard(`aura1-switched-${status.toLowerCase()}`);
        await cardTriggerCharger1.trigger(this, {}, {});

        this.logMessage('trace', `Charger 1 has been turned ${status}.`);
      } catch (error) {
        this.logMessage('error', 'Error occurred while toggling Charger 1:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Charger 1.');
    }
  }

  /***********************************************************************************************************
   * Handles the change in the on/off capability for Charger 2.
   * 
   * This method is triggered when the on/off capability for Charger 2 changes.
   * It checks if the port access allows control of Charger 2, sets the charger
   * settings, updates the capability value, and triggers the appropriate flow card.
   * 
   * @async
   * @param {boolean} value - The new value of the on/off capability. True for on, false for off.
   * @returns {Promise<void>} - A promise that resolves when the operation is complete.
   **********************************************************************************************************/
  async onOnOff2CapabilityChange(value) {
    this.logMessage('normal', 'onOnOff2CapabilityChange triggered with value:', value);

    if (this.portAccess === 'both' || this.portAccess === 'port2') {
      const mode = value ? 1 : 0;
      const status = value ? 'On' : 'Off';

      this.logMessage('trace', `Setting Charger 2 to ${status} with mode: ${mode}`);

      try {
        await Promise.all([
          this.setCharger2Settings(this.aura.port2.current, this.aura.port2.RFID, mode, this.aura.port2.cableLock),
          this.setCapabilityValue('aura2onoffStatus', status)
        ]);

        this.aura.port2.chargerStatus = value;

        // Add trigger card based on if the charger is on or off
        const cardTriggerCharger2 = this.homey.flow.getDeviceTriggerCard(`aura2-switched-${status.toLowerCase()}`);
        await cardTriggerCharger2.trigger(this, {}, {});

        this.logMessage('trace', `Charger 2 has been turned ${status}.`);
      } catch (error) {
        this.logMessage('error', 'Error occurred while toggling Charger 2:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Charger 2.');
    }
  }


  /***********************************************************************************************************
   * Handles the LED ring button action for the Aura device.
   *
   * This method toggles the LED ring status based on the provided value.
   * It ensures that the port access is set to 'both' before performing the action.
   * If the port access is not 'both', it logs a message indicating that the action is not allowed.
   *
   * @async
   * @param {boolean} value - The desired status for the LED ring (true for on, false for off).
   * @returns {Promise<void>} - A promise that resolves when the LED ring status has been successfully toggled.
   **********************************************************************************************************/
  async onAuraLEDringButton(value) {
    this.logMessage('normal', 'onAuraLEDringButton triggered with value:', value);

    if (this.portAccess === 'both') {
      this.logMessage('trace', 'Toggling LED Ring with status:', value);

      try {
        await Promise.all([
          this.setLightAndDimmer(value),
          this.setCapabilityValue('auraLEDringStatus', value)
        ]);

        this.statusLEDring = value;
        this.logMessage('trace', 'LED Ring toggled successfully to:', value);
      } catch (error) {
        this.logMessage('error', 'Error occurred while toggling LED Ring:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: LED ring control is only available when portAccess is "both".');
    }
  }

  /***********************************************************************************************************
   * Handles the RFID button press for Charger 1.
   * 
   * This method checks if the port access allows control of Charger 1's RFID.
   * If allowed, it toggles the RFID status and updates the corresponding capability value.
   * 
   * @param {boolean} value - The value indicating whether the RFID should be turned on or off.
   * @returns {Promise<void>} - A promise that resolves when the RFID status has been successfully toggled.
   * @throws {Error} - Throws an error if there is an issue toggling the RFID status.
   **********************************************************************************************************/
  async onaura1RFIDButton(value) {
    this.logMessage('normal', 'onaura1RFIDButton triggered with value:', value);

    if (this.portAccess === 'both' || this.portAccess === 'port1') {
      this.logMessage('trace', 'Toggling RFID for Charger 1 with value:', value);

      try {
        await Promise.all([
          this.setCharger1Settings(this.aura.port1.current, value, this.aura.port1.chargerStatus, this.aura.port1.cableLock),
          this.setCapabilityValue('aura1RFIDStatus', value ? 'On' : 'Off'),
        ]);

        this.aura.port1.RFID = value;
        this.logMessage('trace', 'RFID for Charger 1 toggled successfully.');
      } catch (error) {
        this.logMessage('error', 'Error occurred while toggling RFID for Charger 1:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: portAccess does not allow control of RFID for Charger 1.');
    }
  }

  /***********************************************************************************************************
   * Handles the cable lock button action for Aura Charger 1.
   *
   * This method is triggered when the cable lock button for Aura Charger 1 is pressed.
   * It checks if the port access allows control of the cable lock for Charger 1 and toggles
   * the cable lock status accordingly.
   *
   * @param {boolean} value - The desired state of the cable lock (true for locked, false for unlocked).
   * @returns {Promise<void>} - A promise that resolves when the cable lock status has been toggled.
   **********************************************************************************************************/
  async onaura1CableLockButton(value) {
    this.logMessage('normal', 'onaura1CableLockButton triggered with value:', value);

    if (this.portAccess === 'both' || this.portAccess === 'port1') {
      this.logMessage('trace', 'Toggling Cable Lock for Charger 1 with value:', value);

      try {
        await Promise.all([
          this.setCharger1Settings(this.aura.port1.current, this.aura.port1.RFID, this.aura.port1.chargerStatus, value),
          this.setCapabilityValue('aura1CableLockStatus', value ? 'On' : 'Off'),
        ]);

        this.aura.port1.cableLock = value;
        this.logMessage('trace', 'Cable Lock for Charger 1 toggled successfully.');
      } catch (error) {
        this.logMessage('error', 'Error occurred while toggling Cable Lock for Charger 1:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Cable Lock for Charger 1.');
    }
  }

  /************************************************************************
   * Handles the RFID button action for Charger 2.
   *
   * This method is triggered when the RFID button for Charger 2 is pressed.
   * It checks if the port access allows control of Charger 2's RFID and toggles
   * the RFID status accordingly.
   *
   * @param {boolean} value - The new RFID status to set (true for On, false for Off).
   * @returns {Promise<void>} - A promise that resolves when the RFID status has been toggled.
   ***********************************************************************/
  async onaura2RFIDButton(value) {
    this.logMessage('normal', 'onaura2RFIDButton triggered with value:', value);

    if (this.portAccess === 'both' || this.portAccess === 'port2') {
      this.logMessage('trace', 'Toggling RFID for Charger 2 with value:', value);

      try {
        await Promise.all([
          this.setCharger2Settings(this.aura.port2.current, value, this.aura.port2.chargerStatus, this.aura.port2.cableLock),
          this.setCapabilityValue('aura2RFIDStatus', value ? 'On' : 'Off'),
        ]);

        this.aura.port2.RFID = value;
        this.logMessage('trace', 'RFID for Charger 2 toggled successfully.');
      } catch (error) {
        this.logMessage('error', 'Error occurred while toggling RFID for Charger 2:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: portAccess does not allow control of RFID for Charger 2.');
    }
  }

  /***********************************************************************************************************
   * Handles the cable lock button action for Charger 2.
   *
   * This method is triggered when the cable lock button for Charger 2 is pressed.
   * It checks if the port access allows control of Charger 2 and toggles the cable lock accordingly.
   *
   * @async
   * @param {boolean} value - The desired state of the cable lock (true for locked, false for unlocked).
   * @returns {Promise<void>} - A promise that resolves when the cable lock state has been successfully toggled.
   **********************************************************************************************************/
  async onaura2CableLockButton(value) {
    this.logMessage('normal', 'onaura2CableLockButton triggered with value:', value);

    if (this.portAccess === 'both' || this.portAccess === 'port2') {
      this.logMessage('trace', 'Toggling Cable Lock for Charger 2 with value:', value);

      try {
        await Promise.all([
          this.setCharger2Settings(this.aura.port2.current, this.aura.port2.RFID, this.aura.port2.chargerStatus, value),
          this.setCapabilityValue('aura2CableLockStatus', value ? 'On' : 'Off'),
        ]);

        this.aura.port2.cableLock = value;
        this.logMessage('trace', 'Cable Lock for Charger 2 toggled successfully.');
      } catch (error) {
        this.logMessage('error', 'Error occurred while toggling Cable Lock for Charger 2:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Cable Lock for Charger 2.');
    }
  }

  // **********************************************************************
  //   MODULE TO HANDLE SETTINGS
  /************************************************************************
   * Handles the settings update event.
   *
   * @async
   * @param {Object} settings - The settings object.
   * @param {Object} settings.oldSettings - The old settings before the update.
   * @param {Object} settings.newSettings - The new settings after the update.
   * @param {Array<string>} settings.changedKeys - The keys that have changed.
   *
   * @returns {Promise<void>} - A promise that resolves when the settings have been processed.
   *
   * @example
   * // Example usage:
   * await onSettings({
   *   oldSettings: { portAccess: 'port1', settingsCurrentLimit: 16 },
   *   newSettings: { portAccess: 'both', settingsCurrentLimit: 20, settingsCurrentLimit2: 25 },
   *   changedKeys: ['portAccess', 'settingsCurrentLimit', 'settingsCurrentLimit2']
   * });
   ***********************************************************************/
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.logMessage('normal', 'onSettings triggered');
    this.logMessage('trace', 'Changed keys:', changedKeys);
    this.logMessage('trace', 'New settings:', newSettings);

    if (newSettings.portAccess) {
      this.portAccess = newSettings.portAccess;
      this.logMessage('trace', `Port access has been updated to: ${this.portAccess}`);
    }

    // update the current limit for Charger 1
    if (newSettings.debugLevel) {
      this.debugLevel = newSettings.debugLevel;
      this.logMessage('trace', `Debug level updated to: ${this.debugLevel}`);
    }

    if (this.portAccess === 'both' || this.portAccess === 'port1') {
      if (changedKeys.includes('settingsCurrentLimit')) {
        this.aura.port1.current = newSettings.settingsCurrentLimit;
        this.logMessage('normal', `Current limit for Charger 1 has been updated to: ${this.aura.port1.current}`);

        try {
          await Promise.all([
            this.setCharger1Settings(this.aura.port1.current, this.aura.port1.RFID, this.aura.port1.chargerStatus, this.aura.port1.cableLock),
            this.setCapabilityValue('aura1CurrentLimit', this.aura.port1.current),
          ]);
          this.logMessage('trace', 'Settings updated for Charger 1 successfully.');
        } catch (error) {
          this.logMessage('error', 'Error updating settings for Charger 1:', error);
        }
      }
    }

    if (this.portAccess === 'both' || this.portAccess === 'port2') {
      if (changedKeys.includes('settingsCurrentLimit2')) {
        this.aura.port2.current = newSettings.settingsCurrentLimit2;
        this.logMessage('normal', `Current limit for Charger 2 has been updated to: ${this.aura.port2.current}`);

        try {
          await Promise.all([
            this.setCharger2Settings(this.aura.port2.current, this.aura.port2.RFID, this.aura.port2.chargerStatus, this.aura.port2.cableLock),
            this.setCapabilityValue('aura2CurrentLimit', this.aura.port2.current),
          ]);
          this.logMessage('trace', 'Settings updated for Charger 2 successfully.');
        } catch (error) {
          this.logMessage('error', 'Error updating settings for Charger 2:', error);
        }
      }
    }
  }

  // **************************************************************************
  //   MODULE TO ACCESS CHARGE AMPS API
  /****************************************************************************
   * Creates an Axios instance configured for the ChargeAmps API.
   * @returns {AxiosInstance} An Axios instance with predefined configuration.
   ****************************************************************************/
  api() {
    return axios.create({
      baseURL: 'https://eapi.charge.space/api/v5',
      timeout: 25000,
      headers: {
        'Content-Type': 'application/json',
        'accept': '*/*',
      },
    });
  }

  // *********************************************************************************************************
  // MODULES TO LOGIN AND RENEW THE API TOKEN AND GET THE OWNED CHARGEPOINTID
  /***********************************************************************************************************
   * Logs in to the ChargeAmps service using the provided user credentials and security key.
   * @param {string} usr - The email address of the user.
   * @param {string} pwd - The password of the user.
   * @param {string} securityKey - The security key for the API.
   * @returns {Promise<string>} A promise that resolves to a string indicating the login status.
   * @throws {Error} Throws an error if the login process fails.
   **********************************************************************************************************/
  async loginCA(usr, pwd, securityKey) {
    this.logMessage('normal', 'ChargeAmps login has been initialized with user:', usr);
    try {
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

      this.logMessage('trace', 'Login successful. Token = ', this.chargeAmpsToken);
      this.logMessage('trace', 'RefreshToken = ', this.chargeAmpsRefreshToken);

      return 'Login Completed';
    } catch (error) {
      this.logMessage('error', 'An error occurred during the login process:', error.message);
      throw error;
    }
  }

  /***********************************************************************************************
   * Asynchronously renews the ChargeAmps authentication token.
   * 
   * This method sends a POST request to the ChargeAmps API to refresh the authentication token
   * using the current token and refresh token. If successful, it updates the instance's token
   * and refresh token with the new values received from the API response.
   ************************************************************************************************/
  async renewToken() {
    this.logMessage('normal', 'ChargeAmps renewToken has been initialized');
    try {
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

      this.logMessage('trace', 'Token renewed successfully. New Token = ', this.chargeAmpsToken);
      this.logMessage('trace', 'New RefreshToken = ', this.chargeAmpsRefreshToken);
    } catch (error) {
      this.logMessage('error', 'An error occurred while renewing the token:', error.message);
    }
  }

  /***********************************************************************************************************
   * Initiates a loop that continuously renews the token every 59 minutes.
   * Logs the start of the loop, attempts to renew the token, and schedules the next renewal.
   * If an error occurs during token renewal, it logs the error message.
   **********************************************************************************************************/
  async renewTokenLoop() {
    this.logMessage('normal', 'Token renewal loop started.');
    try {
      await this.renewToken();

      //Get hourly data from ChargeAmps API
      await this.getHourlyData();
    } catch (error) {
      this.logMessage('error', 'Error during renewToken execution:', error.message);
    }
    this.logMessage('normal', 'Next token renewal scheduled in 59 minutes.');
    setTimeout(() => this.renewTokenLoop(), 1000 * 60 * 59);
  }

  // *********************************************************************************************************
  // MODULES TO CHANGE SETTINGS IN THE CHARGE AMPS API
  /***********************************************************************************************************
   * Sets the settings for Charger 1 if portAccess is 'both' or 'port1'.
   *
   * This function updates the settings of Charger 1 based on the provided parameters.
   * If the user mode is 0, it attempts to perform a remote stop before updating the settings.
   *
   * @param {number} userCurrent - The maximum current to set for the charger.
   * @param {string} userRFID - The RFID to set for the charger.
   * @param {number} userMode - The mode to set for the charger (0 for stop, 1 for start).
   * @param {boolean} userCableLock - The cable lock setting for the charger.
   * @returns {Promise<void>} A promise that resolves when the settings have been updated.
   **********************************************************************************************************/
  async setCharger1Settings(userCurrent, userRFID, userMode, userCableLock) {
    if (this.portAccess === 'both' || this.portAccess === 'port1') {
      this.logMessage('normal', `Setting charger settings with Current: ${userCurrent}, RFID: ${userRFID}, Mode: ${userMode}, CableLock: ${userCableLock}`);

      try {
        if (userMode === 0) {
          this.logMessage('trace', `Requested mode is ${userMode}, attempting remote stop...`);
          try {
            await this.api().put(`/chargepoints/${this.chargeAmpsId}/connectors/1/remotestop`, {}, {
              headers: {
                Authorization: `Bearer ${this.chargeAmpsToken}`,
              },
            });

            this.logMessage('trace', 'Remote stop successful. Waiting for 2 seconds before proceeding...');
            await new Promise(resolve => setTimeout(resolve, 2000));

          } catch (error) {
            this.logMessage('error', 'Failed to stop the charger:', error);
          }
        }

        // Make API call to update charger settings for port 1
        await this.api().put(`/chargepoints/${this.chargeAmpsId}/connectors/1/settings`, {
          chargePointId: this.chargeAmpsId,
          maxCurrent: userCurrent, // Set max current from parameter
          rfidLock: userRFID, // Set RFID from parameter
          mode: userMode, // Set mode from parameter
          cableLock: userCableLock, // Set cable lock from parameter
        }, {
          headers: {
            Authorization: `Bearer ${this.chargeAmpsToken}`,
          },
        });
        this.logMessage('trace', 'Charger 1 settings updated successfully.');
      } catch (error) {
        this.logMessage('error', 'Error encountered:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Charger 1.');
    }
  }

  /************************************************************************
   * Sets the settings for Charger 2 if portAccess are both or port2.
   *
   * @param {number} userCurrent - The maximum current to set for the charger.
   * @param {string} userRFID - The RFID to set for the charger.
   * @param {number} userMode - The mode to set for the charger (0 for stop).
   * @param {boolean} userCableLock - The cable lock setting for the charger.
   * @returns {Promise<void>} A promise that resolves when the settings have been updated.
   ***********************************************************************/
  async setCharger2Settings(userCurrent, userRFID, userMode, userCableLock) {
    if (this.portAccess === 'both' || this.portAccess === 'port2') {
      this.logMessage('normal', `Setting charger settings with Current: ${userCurrent}, RFID: ${userRFID}, Mode: ${userMode}, CableLock: ${userCableLock}`);

      try {
        if (userMode === 0) {
          this.logMessage('trace', `Requested mode is ${userMode}, attempting remote stop...`);
          try {
            await this.api().put(`/chargepoints/${this.chargeAmpsId}/connectors/2/remotestop`, {}, {
              headers: {
                Authorization: `Bearer ${this.chargeAmpsToken}`,
              },
            });

            this.logMessage('trace', 'Remote stop successful. Waiting for 2 seconds before proceeding...');
            await new Promise(resolve => setTimeout(resolve, 2000));

          } catch (error) {
            this.logMessage('error', 'Failed to stop the charger:', error);
          }
        }

        // Make API call to update charger settings for port 2
        await this.api().put(`/chargepoints/${this.chargeAmpsId}/connectors/2/settings`, {
          chargePointId: this.chargeAmpsId,
          maxCurrent: userCurrent, // Set max current from parameter
          rfidLock: userRFID, // Set RFID from parameter
          mode: userMode, // Set mode from parameter
          cableLock: userCableLock, // Set cable lock from parameter
        }, {
          headers: {
            Authorization: `Bearer ${this.chargeAmpsToken}`,
          },
        });
        this.logMessage('trace', 'Charger 2 settings updated successfully.');
      } catch (error) {
        this.logMessage('error', 'Error encountered:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: portAccess does not allow control of Charger 2.');
    }
  }


  /***********************************************************************************************************
   * Sets the LED ring dimmer settings for the device.
   * 
   * This function checks if the port access is set to 'both' before making an API call
   * to update the LED ring dimmer settings. If the port access is not 'both', it logs
   * an appropriate message and does not proceed with the API call.
   **********************************************************************************************************/
  async setLightAndDimmer(userDimmer) {
    if (this.portAccess === 'both') {
      try {
        this.logMessage('normal', 'Making API call to set LED ring dimmer settings...', { userDimmer });

        // make API call to update LED ring dimmer settings
        await this.api().put(`/chargepoints/${this.chargeAmpsId}/settings`, {
          id: this.chargeAmpsId,
          downLight: false,
          dimmer: userDimmer,
        }, {
          headers: {
            Authorization: `Bearer ${this.chargeAmpsToken}`,
          },
        });

        this.logMessage('trace', 'Successfully set LED ring dimmer to', { userDimmer });
      } catch (error) {
        this.logMessage('error', 'Error encountered while setting LED ring:', error);
      }
    } else {
      this.logMessage('normal', 'Action not allowed: LED ring settings can only be changed when portAccess is "both".');
    }
  }

  // *****************************************************************************************************************************************
  // MODULES TO GET DATA FROM THE CHARGE AMPS API
  /*******************************************************************************************************************************************
   * Continuously fetches Charge Amps data in a loop with dynamic timeout intervals.
   * 
   * This function logs the current port access setting before each execution and checks a flag to prevent concurrent data fetching.
   * If the flag is not set, it attempts to fetch the data and logs the time taken for the operation.
   * The timeout for the next execution is calculated based on the elapsed time, with a minimum of 14 seconds and a maximum of 60 seconds.
   * In case of an error during data fetching, the function logs the error and retries after 15 seconds.
   * If the flag is set, it retries after 15 seconds.
   ******************************************************************************************************************************************/
  async getCAdataLoop() {
    // Check that getCAdata is not already running
    if (!this.isGettingData) {
      try {
        const startTime = Date.now();
        await this.getCAdata();  // run getCAdata function to fetch data
        const endTime = Date.now();
        const elapsedTime = (endTime - startTime) / 1000;
        this.logMessage('normal', `INFORMATION: getCAdata took ${elapsedTime} seconds to complete`);

        const minTimeout = 14;
        const maxTimeout = 60;
        const timeout = Math.round(Math.max(minTimeout, Math.min(maxTimeout, minTimeout + (elapsedTime * 2) / 3)));

        this.logMessage('normal', `Next getCAdata will be executed in ${timeout} seconds`);
        setTimeout(() => this.getCAdataLoop(), timeout * 1000);
      } catch (error) {
        this.logMessage('error', 'Error during getCAdata execution:', error);
        setTimeout(() => this.getCAdataLoop(), 15 * 1000);
      }
    } else {
      setTimeout(() => this.getCAdataLoop(), 15 * 1000);
    }
  }

  /***********************************************************************************************************
   * Fetches ChargeAmps data and processes the status and consumption for ports 1 and 2.
   * 
   * This method performs the following steps:
   * 1. Logs the initialization of data fetching.
   * 2. Checks if data fetching is already in progress.
   * 3. Sets a flag to indicate data fetching is in progress.
   * 4. Makes an API call to fetch the status of the charge points.
   * 5. Logs the API response.
   * 6. Processes the status and consumption data for Port 1 if access is allowed.
   * 7. Processes the status and consumption data for Port 2 if access is allowed.
   * 8. Handles various status transitions and triggers corresponding flows.
   * 9. Resets the flag to indicate data fetching is complete.
   **********************************************************************************************************/
  async getCAdata() {
    this.logMessage('normal', 'Getting ChargeAmps DATA has been initialized');

    // Check if getCAdata is already running
    if (this.isGettingData) {
      this.logMessage('trace', 'getCAdata is already running, skipping');
      return;
    }

    // Set flag to indicate data fetching is in progress
    this.isGettingData = true;

    try {
      let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/status`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      // Log API response
      this.logMessage('full', 'API response received:', JSON.stringify(response.data, null, 2));

      // Handle STATUS data for Port 1
      if (this.portAccess === 'both' || this.portAccess === 'port1') {
        this.logMessage('trace', 'Port 1 access confirmed. Beginning to process data for Port 1...');
        let originalCarConnected = this.getCapabilityValue('aura1CarConnected');

        this.aura.port1.nowConsumptionKwh = response.data.connectorStatuses[0].totalConsumptionKwh;
        this.logMessage('trace', `Now Consumption KWh for Port 1: ${this.aura.port1.nowConsumptionKwh}`); // Power consumption during the charging cycle

        // Check if charging is ongoing
        if (this.aura.port1.nowConsumptionKwh !== 0) {
          let { measurements: measurements1 } = response.data.connectorStatuses[0];
          this.logMessage('full', `Charging is active on Port 1, data for Port 1: ${JSON.stringify(measurements1)}`); // Show all data in log

          // If no measurements are available
          if (!measurements1) {
            this.aura.port1.nowConsumptionKwh = 0; // Set consumption to 0 if no charging is done
            this.logMessage('trace', 'No measurements available for Port 1. Setting consumption to 0.');
          } else if (measurements1.length > 0) {
            let consumption = measurements1.slice(0, 3).reduce((acc, measurement) => acc + measurement.current * measurement.voltage, 0);
            this.logMessage('trace', `Calculated Consumption for Port 1 (W): ${consumption}`);
            this.aura.port1.chargingConsumptionKwh = consumption / 1000;
            this.logMessage('trace', `Charging Consumption for Port 1 (W) set to: ${this.aura.port1.chargingConsumptionKwh}`);
          }
        } else {
          this.logMessage('trace', 'No active charging detected on Port 1.');
        }

        let { status: status1 } = response.data.connectorStatuses[0];
        this.logMessage('trace', `Status for Port 1 from API: ${status1}`); // Displays the current status of the outlet

        // Adjust originalCarConnected based on status from the API
        if (originalCarConnected === 'Disconnected') {
          originalCarConnected = 'Available';
          this.logMessage('trace', 'Original Car Connected 1 status adjusted from "Disconnected" to "Available".');
        }
        if (originalCarConnected === 'Unknown') {
          originalCarConnected = 'Available';
          this.logMessage('trace', 'Original Car Connected 1 status adjusted from "Unknown" to "Available".');
        }

        this.logMessage('trace', `Corrected Original Car Connected for Port 1: ${originalCarConnected}`);

        let chargerStatus = status1;
        this.logMessage('trace', `Charger Status for Port 1 initialized to: ${chargerStatus}`);

        // If charging completed and status changed to Connected
        if (originalCarConnected === 'Charging' && status1 === 'Connected') {
          this.logMessage('trace', 'Charging completed for Port 1. Updating status to "Connected".');
          chargerStatus = 'Connected';
          this.homey.flow.getDeviceTriggerCard('aura1-chargerChargingCompleted').trigger(this, {}, {}).catch(this.error);
          await this.setCapabilityValue('aura1CarConnected', chargerStatus);
          this.logMessage('trace', 'Port 1 Charging Completed flow triggered and capability updated.');
        }

        // If charging completed and status changed to SuspendedEV
        if (originalCarConnected === 'Charging' && status1 === 'SuspendedEV') {
          this.logMessage('trace', 'Charging suspended for Port 1. Updating status to "Connected".');
          chargerStatus = 'Connected';
          this.homey.flow.getDeviceTriggerCard('aura1-chargerChargingCompleted').trigger(this, {}, {}).catch(this.error);
          await this.setCapabilityValue('aura1CarConnected', chargerStatus);
          this.logMessage('trace', 'Port 1 Charging Suspended flow triggered and capability updated.');
        }

        // If charging completed and status changed to Finishing
        if (originalCarConnected === 'Charging' && status1 === 'Finishing') {
          this.logMessage('trace', 'Charging finishing for Port 1. Updating status to "Finishing".');
          chargerStatus = 'Finishing';
          this.homey.flow.getDeviceTriggerCard('aura1-chargerChargingCompleted').trigger(this, {}, {}).catch(this.error);
          await this.setCapabilityValue('aura1CarConnected', chargerStatus);
          this.logMessage('trace', 'Port 1 Charging Finishing flow triggered and capability updated.');
        }

        // Check if status has changed for Port 1
        if (status1 !== originalCarConnected) {
          this.logMessage('trace', `Detected status change for Port 1 from ${originalCarConnected} to ${status1}. Handling status transition...`);
          switch (status1) {
            case 'Available':
              chargerStatus = 'Disconnected';
              this.logMessage('trace', 'Port 1 is now Disconnected. Triggering flow.');
              this.homey.flow.getDeviceTriggerCard('aura1-chargerDisconnected').trigger(this, {}, {}).catch(this.error);
              break;
            case 'Connected':
              chargerStatus = 'Connected';
              this.logMessage('trace', 'Port 1 is now Connected. Triggering flow.');
              this.homey.flow.getDeviceTriggerCard('aura1-chargerConnected').trigger(this, {}, {}).catch(this.error);
              break;
            case 'Charging':
              chargerStatus = 'Charging';
              this.logMessage('trace', 'Port 1 is Charging. Triggering flow.');
              this.homey.flow.getDeviceTriggerCard('aura1-chargerCharging').trigger(this, {}, {}).catch(this.error);
              break;
            default:
              this.logMessage('trace', `Port 1 has unknown status: ${status1}`);
              chargerStatus = status1;
              break;
          }
          await this.setCapabilityValue('aura1CarConnected', chargerStatus);
          this.logMessage('trace', `Port 1 status updated to: ${chargerStatus}`);
        }
      } else {
        // If portAccess is 'port2', set aura1CarConnected to 'Off'
        this.logMessage('trace', 'Port 2 only access detected. Setting aura1CarConnected to Off.');
        await this.setCapabilityValue('aura1CarConnected', 'Off');
      }

      // Handle STATUS data for Port 2
      if (this.portAccess === 'both' || this.portAccess === 'port2') {
        this.logMessage('trace', 'Port 2 access confirmed. Beginning to process data for Port 2...');
        let originalCarConnected2 = this.getCapabilityValue('aura2CarConnected');

        // Check if portAccess includes Port 2
        if (this.portAccess === 'both') {
          // Get new data for Port 2 from the ChargeAmps API when portAccess is 'both'
          this.aura.port2.nowConsumptionKwh = response.data.connectorStatuses[1].totalConsumptionKwh;
          this.logMessage('trace', `Now Consumption KWh for Port 2 (access both): ${this.aura.port2.nowConsumptionKwh}`); // Power consumption during the charging cycle
        } else {
          // Get new data for Port 2 from the ChargeAmps API when portAccess is 'port2'
          this.aura.port2.nowConsumptionKwh = response.data.connectorStatuses[0].totalConsumptionKwh;
          this.logMessage('trace', `Now Consumption KWh for Port 2 (access port2): ${this.aura.port2.nowConsumptionKwh}`); // Power consumption during the charging cycle
        }

        // Check if charging is ongoing for Port 2
        if (this.aura.port2.nowConsumptionKwh !== 0) {
          let measurements2;
          if (this.portAccess === 'both') {
            // If portAccess is 'both', use index 1
            ({ measurements: measurements2 } = response.data.connectorStatuses[1]);
          } else if (this.portAccess === 'port2') {
            // If portAccess is 'port2', use index 0
            ({ measurements: measurements2 } = response.data.connectorStatuses[0]);
          }
          this.logMessage('full', `Measurements for Port 2: ${JSON.stringify(measurements2)}`); // Debug to show all raw data for measurements

          // If no measurements are available
          if (!measurements2) {
            this.aura.port2.nowConsumptionKwh = 0; // Set consumption to 0 if no charging is done
            this.logMessage('trace', 'No measurements available for Port 2. Setting consumption to 0.');
          } else if (measurements2.length > 0) {
            let consumption2 = measurements2.slice(0, 3).reduce((acc, measurement) => acc + measurement.current * measurement.voltage, 0);
            this.logMessage('trace', `Calculated Consumption for Port 2 (W): ${consumption2}`);
            this.aura.port2.chargingConsumptionKwh = consumption2 / 1000;
            this.logMessage('trace', `Charging Consumption for Port 2 (W) set to: ${this.aura.port2.chargingConsumptionKwh}`);
          }
        } else {
          this.logMessage('trace', 'No active charging detected on Port 2.');
        }

        let status2;
        // Check if portAccess is 'both' or 'port2' and select the correct index
        if (this.portAccess === 'both') {
          // Use index 1 if portAccess is 'both'
          status2 = response.data.connectorStatuses[1].status;
        } else if (this.portAccess === 'port2') {
          // Use index 0 if portAccess is 'port2'
          status2 = response.data.connectorStatuses[0].status;
        }
        this.logMessage('trace', `Status for Port 2 from API: ${status2}`); // Displays the current status of the outlet

        // Adjust originalCarConnected2 based on status from API
        if (originalCarConnected2 === 'Disconnected') {
          originalCarConnected2 = 'Available';
          this.logMessage('trace', 'Original Car Connected 2 status adjusted from "Disconnected" to "Available".');
        }
        if (originalCarConnected2 === 'Unknown') {
          originalCarConnected2 = 'Available';
          this.logMessage('trace', 'Original Car Connected 2 status adjusted from "Unknown" to "Available".');
        }

        this.logMessage('trace', `Corrected Original Car Connected for Port 2: ${originalCarConnected2}`);

        let chargerStatus2 = status2;
        this.logMessage('trace', `Charger Status for Port 2 initialized to: ${chargerStatus2}`);

        // If charging completed and status changed to Connected
        if (originalCarConnected2 === 'Charging' && status2 === 'Connected') {
          this.logMessage('trace', 'Charging completed for Port 2. Updating status to "Connected".');
          chargerStatus2 = 'Connected';
          this.homey.flow.getDeviceTriggerCard('aura2-chargerChargingCompleted').trigger(this, {}, {}).catch(this.error);
          await this.setCapabilityValue('aura2CarConnected', chargerStatus2);
          this.logMessage('trace', 'Port 2 Charging Completed flow triggered and capability updated.');
        }

        // If charging completed and status changed to SuspendedEV
        if (originalCarConnected2 === 'Charging' && status2 === 'SuspendedEV') {
          this.logMessage('trace', 'Charging suspended for Port 2. Updating status to "Connected".');
          chargerStatus2 = 'Connected';
          this.homey.flow.getDeviceTriggerCard('aura2-chargerChargingCompleted').trigger(this, {}, {}).catch(this.error);
          await this.setCapabilityValue('aura2CarConnected', chargerStatus2);
          this.logMessage('trace', 'Port 2 Charging Suspended flow triggered and capability updated.');
        }

        // If charging completed and status changed to Finishing
        if (originalCarConnected2 === 'Charging' && status2 === 'Finishing') {
          this.logMessage('trace', 'Charging finishing for Port 2. Updating status to "Finishing".');
          chargerStatus2 = 'Finishing';
          this.homey.flow.getDeviceTriggerCard('aura2-chargerChargingCompleted').trigger(this, {}, {}).catch(this.error);
          await this.setCapabilityValue('aura2CarConnected', chargerStatus2);
          this.logMessage('trace', 'Port 2 Charging Finishing flow triggered and capability updated.');
        }

        // Check if status has changed for Port 2
        if (status2 !== originalCarConnected2) {
          this.logMessage('trace', `Detected status change for Port 2 from ${originalCarConnected2} to ${status2}. Handling status transition...`);
          switch (status2) {
            case 'Available':
              chargerStatus2 = 'Disconnected';
              this.logMessage('trace', 'Port 2 is now Disconnected. Triggering flow.');
              this.homey.flow.getDeviceTriggerCard('aura2-chargerDisconnected').trigger(this, {}, {}).catch(this.error);
              break;
            case 'Connected':
              chargerStatus2 = 'Connected';
              this.logMessage('trace', 'Port 2 is now Connected. Triggering flow.');
              this.homey.flow.getDeviceTriggerCard('aura2-chargerConnected').trigger(this, {}, {}).catch(this.error);
              break;
            case 'Charging':
              chargerStatus2 = 'Charging';
              this.logMessage('trace', 'Port 2 is Charging. Triggering flow.');
              this.homey.flow.getDeviceTriggerCard('aura2-chargerCharging').trigger(this, {}, {}).catch(this.error);
              break;
            default:
              this.logMessage('trace', `Port 2 has unknown status: ${status2}`);
              chargerStatus2 = status2;
              break;
          }
          await this.setCapabilityValue('aura2CarConnected', chargerStatus2);
          this.logMessage('trace', `Port 2 status updated to: ${chargerStatus2}`);
        }
      } else {
        // If portAccess is 'port1', set aura2CarConnected to 'Off'
        this.logMessage('trace', 'Port 1 only access detected. Setting aura2CarConnected to Off.');
        await this.setCapabilityValue('aura2CarConnected', 'Off');
      }
    } catch (error) {
      this.logMessage('error', 'PROBLEM:', error);
    } finally {
      await this.getChargingInfo();
      // Reset the flag once data collection is complete
      this.isGettingData = false;
    }
  }

  /***********************************************************************************************************
  * Retrieves and processes charging information for Charger 1.
  * 
  * This method checks if the port access is valid ('both' or 'port1'). If valid, it makes an API call to
  * fetch charging session data for Charger 1 and processes it to update various capabilities, such as power
  * consumption (`measure_aura1`), last charged session (`aura1LastCharged`), and meter values (`meter_aura1`).
  * 
  * If the port access is not valid, it defaults the capabilities to 0 or 'Off'.
  * This method also calculates consumption differences to maintain accurate meter readings.
  ************************************************************************************************************/
  async getChargingInfo() {
    // Kontrollera om laddningsporten är påslagen innan API-anropet
    if (!this.getCapabilityValue('aura1onoffButton')) {
      this.logMessage('normal', 'Charging port is OFF, skipping API call that collects charging data.');

      // Sätt defaultvärden istället för att avbryta och gå vidare till nästa modul
      await Promise.all([
        this.setCapabilityValue('aura1LastCharged', '0'),
        this.setCapabilityValue('aura1NowCharged', '0'),
        this.setCapabilityValue('measure_aura1', 0),
        this.setCapabilityValue('meter_aura1', 0)
      ]);

      // Fortsätt direkt till nästa modul i kedjan
      await this.getChargingInfo2();
      return; // Avsluta denna modul men fortsätt kedjan
    }

    if (this.portAccess === 'both' || this.portAccess === 'port1') {
      this.logMessage('normal', 'Getting Charging 1 info has been initialized');
      try {
        let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/connectors/1/chargingsessions?maxCount=2`, {
          headers: {
            Authorization: `Bearer ${this.chargeAmpsToken}`,
          },
          timeout: 90000,
        });

        this.logMessage('full', 'API response received for Charging data Port 1:', JSON.stringify(response.data, null, 2));

        let chargingInfo1;
        this.aura.port1.meterChargingKWH = this.getCapabilityValue('meter_aura1');
        this.logMessage('trace', 'Current meter_aura1 capability value (aura1Meter):', this.aura.port1.meterChargingKWH);

        if (this.aura.port1.meterChargingKWH === null || isNaN(this.aura.port1.meterChargingKWH)) {
          this.logMessage('trace', 'meter_aura1 is null or NaN. Setting to 0.');
          this.aura.port1.meterChargingKWH = 0;
        }

        this.logMessage('trace', 'Current aura1nowConsumptionKwh value:', this.aura.port1.nowConsumptionKwh);

        if (this.aura.port1.nowConsumptionKwh === 0) {
          this.logMessage('trace', 'aura1nowConsumptionKwh is 0. Setting aura1previousConsumptionKwh to 0.');
          this.aura.port1.previousConsumptionKwh = 0;

          // Check if response.data[0] exists and has totalConsumptionKwh before calling toFixed
          if (response.data && response.data[0] && response.data[0].totalConsumptionKwh != null) {
            this.logMessage('trace', 'Charging session data for Charger 1 found. Processing totalConsumptionKwh...');
            chargingInfo1 = response.data[0].totalConsumptionKwh.toFixed(2);
          } else {
            this.logMessage('trace', 'No charging session data available for Charger 1.');
            chargingInfo1 = '0';  // Fallback if no data is available
          }

          this.logMessage('trace', 'Setting measure_aura1 to 0.');
          await this.setCapabilityValue('measure_aura1', 0);
        } else {
          this.logMessage('trace', 'Calculating delta between aura1nowConsumptionKwh and aura1previousConsumptionKwh...');
          const delta = this.aura.port1.nowConsumptionKwh - this.aura.port1.previousConsumptionKwh;
          this.aura.port1.meterChargingKWH += delta;
          this.logMessage('trace', 'Updated aura1meterChargingKWH:', this.aura.port1.meterChargingKWH);

          this.aura.port1.previousConsumptionKwh = this.aura.port1.nowConsumptionKwh;
          this.logMessage('trace', 'Updated aura1previousConsumptionKwh:', this.aura.port1.previousConsumptionKwh);

          // Check if response.data[1] exists and has totalConsumptionKwh before calling toFixed
          if (response.data && response.data[1] && response.data[1].totalConsumptionKwh != null) {
            this.logMessage('trace', 'Second charging session data for Charger 1 found. Processing totalConsumptionKwh...');
            chargingInfo1 = response.data[1].totalConsumptionKwh.toFixed(2);
          } else {
            this.logMessage('trace', 'No second charging session data available for Charger 1.');
            chargingInfo1 = '0';  // Fallback if no data is available
          }

          const validChargingConsumptionKwh1 = this.aura.port1.chargingConsumptionKwh !== undefined ? this.aura.port1.chargingConsumptionKwh : 0;
          this.logMessage('trace', 'Setting measure_aura1 and meter_aura1 values...');
          await Promise.all([
            this.setCapabilityValue('measure_aura1', validChargingConsumptionKwh1),
            this.setCapabilityValue('meter_aura1', this.aura.port1.meterChargingKWH),
          ]);
        }

        this.logMessage('trace', 'Setting aura1LastCharged and aura1NowCharged values...');
        await Promise.all([
          this.setCapabilityValue('aura1LastCharged', chargingInfo1),
          this.setCapabilityValue('aura1NowCharged', this.aura.port1.nowConsumptionKwh != null ? this.aura.port1.nowConsumptionKwh.toFixed(2) : '0'),
        ]);
      } catch (error) {
        this.logMessage('error', 'Error encountered:', error);
      }
    } else {
      this.logMessage('trace', 'Action not allowed: Charging info for Charger 1 can only be retrieved when portAccess is "both" or "port1".');
      this.setCapabilityValue('aura1LastCharged', '0');
      this.setCapabilityValue('aura1NowCharged', '0');
      this.setCapabilityValue('measure_aura1', 0);
      this.setCapabilityValue('meter_aura1', 0);
    }
    await this.getChargingInfo2();
  }

  /*****************************************************************************************************************
   * Retrieves and processes charging information for Charger 2.
   * 
   * Similar to `getChargingInfo` for Charger 1, this method checks if the port access is valid ('both' or 'port2').
   * If valid, it fetches charging session data for Charger 2 from the ChargeAmps API and processes it to update
   * capabilities like `measure_aura2`, `aura2LastCharged`, and `meter_aura2`.
   * 
   * If `portAccess` is 'both', it also calculates the combined consumption values for both ports and updates
   * the total (`measure_both`, `meter_both`) accordingly.
   * 
   * If the port access is not valid, the capabilities for Charger 2 are defaulted to 0 or 'Off'.
   ****************************************************************************************************************/
  async getChargingInfo2() {
    // Kontrollera om laddningsporten är påslagen innan API-anropet
    if (!this.getCapabilityValue('aura2onoffButton')) {
      this.logMessage('normal', 'Charging port is OFF, skipping API call that collects charging data.');
      // Sätt defaultvärden istället för att avbryta och gå vidare till nästa modul
      await Promise.all([
        this.setCapabilityValue('aura2LastCharged', '0'),
        this.setCapabilityValue('aura2NowCharged', '0'),
        this.setCapabilityValue('measure_aura2', 0),
        this.setCapabilityValue('meter_aura2', 0)
      ]);
      return; // Avbryt om porten är avstängd
    }
    if (this.portAccess === 'both' || this.portAccess === 'port2') {
      this.logMessage('normal', 'Getting Charging 2 info');
      try {
        let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/connectors/2/chargingsessions?maxCount=2`, {
          headers: {
            Authorization: `Bearer ${this.chargeAmpsToken}`,
          },
          timeout: 90000,
        });

        this.logMessage('full', 'API response received for Charging data Port 2:', JSON.stringify(response.data, null, 2));

        let chargingInfo2;
        this.aura.port2.meterChargingKWH = this.getCapabilityValue('meter_aura2');
        this.logMessage('trace', 'Current meter_aura2 capability value:', this.aura.port2.meterChargingKWH);

        if (this.aura.port2.meterChargingKWH === null || isNaN(this.aura.port2.meterChargingKWH)) {
          this.logMessage('trace', 'meter_aura2 is null or NaN. Setting to 0.');
          this.aura.port2.meterChargingKWH = 0;
        }

        this.logMessage('trace', 'Current aura2nowConsumptionKwh value:', this.aura.port2.nowConsumptionKwh);

        if (this.aura.port2.nowConsumptionKwh === 0) {
          this.logMessage('trace', 'aura2nowConsumptionKwh is 0. Setting aura2previousConsumptionKwh to 0.');
          this.aura.port2.previousConsumptionKwh = 0;

          // Check if response.data[0] exists and has totalConsumptionKwh before calling toFixed
          if (response.data && response.data[0] && response.data[0].totalConsumptionKwh != null) {
            this.logMessage('trace', 'Charging session data for Charger 2 found. Processing totalConsumptionKwh...');
            chargingInfo2 = response.data[0].totalConsumptionKwh.toFixed(2);
          } else {
            this.logMessage('trace', 'No charging session data available for Charger 2.');
            chargingInfo2 = '0';  // Fallback if no data is available
          }

          this.logMessage('trace', 'Setting measure_aura2 to 0.');
          await this.setCapabilityValue('measure_aura2', 0);
        } else {
          this.logMessage('trace', 'Calculating delta between aura2nowConsumptionKwh and aura2previousConsumptionKwh...');
          const delta = this.aura.port2.nowConsumptionKwh - this.aura.port2.previousConsumptionKwh;
          this.aura.port2.meterChargingKWH += delta;
          this.logMessage('trace', 'Updated aura2meterChargingKWH:', this.aura.port2.meterChargingKWH);

          this.aura.port2.previousConsumptionKwh = this.aura.port2.nowConsumptionKwh;
          this.logMessage('trace', 'Updated aura2previousConsumptionKwh:', this.aura.port2.previousConsumptionKwh);

          // Check if response.data[1] exists and has totalConsumptionKwh before calling toFixed
          if (response.data && response.data[1] && response.data[1].totalConsumptionKwh != null) {
            this.logMessage('trace', 'Second charging session data for Charger 2 found. Processing totalConsumptionKwh...');
            chargingInfo2 = response.data[1].totalConsumptionKwh.toFixed(2);
          } else {
            this.logMessage('trace', 'No second charging session data available for Charger 2.');
            chargingInfo2 = '0';  // Fallback if no data is available
          }

          const validChargingConsumptionKwh2 = this.aura.port2.chargingConsumptionKwh !== undefined ? this.aura.port2.chargingConsumptionKwh : 0;
          this.logMessage('trace', 'Setting measure_aura2 and meter_aura2 values...');
          await Promise.all([
            this.setCapabilityValue('measure_aura2', validChargingConsumptionKwh2),
            this.setCapabilityValue('meter_aura2', this.aura.port2.meterChargingKWH),
          ]);
        }

        this.logMessage('trace', 'Setting aura2LastCharged and aura2NowCharged values...');
        await Promise.all([
          this.setCapabilityValue('aura2LastCharged', chargingInfo2),
          this.setCapabilityValue('aura2NowCharged', this.aura.port2.nowConsumptionKwh != null ? this.aura.port2.nowConsumptionKwh.toFixed(2) : '0'),
        ]);

      } catch (error) {
        this.logMessage('error', 'Error encountered:', error);
      } finally {
        this.isGettingData = false;
        this.logMessage('trace', 'Finished data collection from ChargeAmps API for Charger 2.');
      }
    } else {
      this.logMessage('trace', 'Action not allowed: Charging info for Charger 2 can only be retrieved when portAccess is "both" or "port2".');
      await this.setCapabilityValue('aura2LastCharged', '0');
      await this.setCapabilityValue('aura2NowCharged', '0');
      await this.setCapabilityValue('measure_aura2', 0);
      await this.setCapabilityValue('meter_aura2', 0);
    }

    if (this.portAccess === 'both') {
      const meterPower = this.getCapabilityValue('meter_aura1') || 0;
      const meterAura2 = this.getCapabilityValue('meter_aura2') || 0;
      const measurePower = this.getCapabilityValue('measure_aura1') || 0;
      const measureAura2 = this.getCapabilityValue('measure_aura2') || 0;
      const meterBoth = meterPower + meterAura2;
      const measureBoth = measurePower + measureAura2;
      this.logMessage('trace', `Calculated meter_both: ${meterBoth}, measure_both: ${measureBoth}`);

      await Promise.all([
        this.setCapabilityValue('meter_both', meterBoth),
        this.setCapabilityValue('measure_both', measureBoth),
      ]);
    }
    this.logMessage('normal', 'Finished info collection from ChargeAmps');
  }

  /********************************************************************************************/
  async getHourlyData() {
    await this.getOwnedChargepointsInfo();
  }

  /******************************************************************************************
    * Fetches information about owned chargepoints from the ChargeAmps API.
    * 
    * This method makes an API call to the `/chargepoints/owned` endpoint to retrieve
    * data about the chargepoints owned by the user. It then processes the response
    * to find the chargepoint that matches the current device's ID and updates the
    * device's capabilities for firmware version and OCPP/CAPI version accordingly.
    * 
    * @async
    * @function getOwnedChargepointsInfo
    * @returns {Promise<void>} A promise that resolves when the operation is complete.
    * @throws Will log an error message if the API call fails or if no matching device is found.
    ********************************************************************************************/
  async getOwnedChargepointsInfo() {
    try {
      // make API call to get owned chargepoints
      let response = await this.api().get(`/chargepoints/owned`, {
        headers: {
          Authorization: `Bearer ${this.chargeAmpsToken}`,
        },
        timeout: 90000,
      });

      // log the data received from the API
      this.logMessage('full', 'Owned chargepoints data received from ChargeAmps:', JSON.stringify(response.data, null, 2));

      if (Array.isArray(response.data) && response.data.length > 0) {
        // search for the device with the matching ID
        const matchedDevice = response.data.find(device => device.id === this.chargeAmpsId);

        if (matchedDevice) {
          // store the firmware version and OCPP/CAPI version for the device
          this.firmwareVersion = matchedDevice.firmwareVersion;

          // set the OCPP/CAPI version to 'CAPI' if the value is null
          this.ocppVersion = matchedDevice.ocppVersion === null ? 'CAPI' : 'OCPP';

          // log the firmware and OCPP/CAPI versions
          this.logMessage('normal', `Firmware Version: ${this.firmwareVersion}`);
          this.logMessage('normal', `OCPP/CAPI Version: ${this.ocppVersion}`);

          // set the capability values for firmware and OCPP/CAPI versions
          await Promise.all([
            this.setCapabilityValue('auraFW', this.firmwareVersion),
            this.setCapabilityValue('auraVersion', this.ocppVersion),
          ]);
        } else {
          this.logMessage('error', `No matching device found for ID: ${this.chargeAmpsId}`);
        }
      } else {
        this.logMessage('error', 'No chargepoints found in response');
      }

      response = null;
    } catch (error) {
      // handle any errors that occur during the API call
      this.logMessage('error', 'Axios error:', error);
    } finally {
      await this.getLightinfo();
    }
  }

  /***********************************************************************************************************************
   * Retrieves and updates the LED ring light information for the AURA device.
   * 
   * If `portAccess` is set to 'both', this method fetches the current LED ring settings from the ChargeAmps API
   * (such as dimmer levels) and updates the corresponding capability values (`auraLEDringStatus` and `auraLEDringButton`).
   * 
   * If the port access is set to 'port1' or 'port2', LED ring functionality is disabled and set to 'Off' since the
   * LED ring can only be controlled when both ports are active. This ensures consistency in device behavior based
   * on port access.
   **********************************************************************************************************************/
  async getLightinfo() {
    if (this.portAccess === 'both') {
      try {
        this.logMessage('normal', 'Making API call to ChargeAmps for light info...');
        let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/settings`, {
          headers: {
            Authorization: `Bearer ${this.chargeAmpsToken}`,
          },
          timeout: 90000,
        });

        this.logMessage('full', 'API response received for Lights:', JSON.stringify(response.data, null, 2));

        this.statusLEDring = response.data.dimmer;
        this.logMessage('trace', 'LED ring status (dimmer):', this.statusLEDring);

        await Promise.all([
          this.setCapabilityValue('auraLEDringStatus', this.statusLEDring),
          this.setCapabilityValue('auraLEDringButton', this.statusLEDring),
        ]);

        this.logMessage('trace', 'Capability values for LED ring updated successfully.');
      } catch (error) {
        this.logMessage('error', 'Error encountered:', error);
      } finally {
        await this.getChargerInfo();
      }
    } else {
      this.logMessage('trace', 'Action not allowed: Light info can only be retrieved when portAccess is "both".');
      this.logMessage('trace', 'Setting auraLEDringStatus to "Off"');
      await this.setCapabilityValue('auraLEDringStatus', 'Off');
      await this.getChargerInfo();
    }
  }

  /***********************************************************************************************************
   * Retrieves and updates the charger information for Charger 1.
   * 
   * This function checks if the port access is either 'both' or 'port1'. If valid, it fetches the charger information
   * from the API and updates the corresponding status and capability values. If the port access is not valid, it sets
   * the capability values to their default states.
   **********************************************************************************************************/
  async getChargerInfo() {
    if (this.portAccess === 'both' || this.portAccess === 'port1') {
      this.logMessage('normal', 'Getting Charger 1 info has been initialized');
      try {
        let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/connectors/1/settings`, {
          headers: {
            Authorization: `Bearer ${this.chargeAmpsToken}`,
          },
          timeout: 90000,
        });

        this.logMessage('full', 'API response received for Charger 1:', JSON.stringify(response.data, null, 2));

        this.aura.port1.current = response.data.maxCurrent;
        this.aura.port1.chargerStatus = response.data.mode;
        this.aura.port1.RFID = response.data.rfidLock;
        this.aura.port1.cableLock = response.data.cableLock;

        await Promise.all([
          this.setCapabilityValue('aura1onoffStatus', this.aura.port1.chargerStatus), // Status Indicator
          this.setCapabilityValue('aura1onoffButton', this.aura.port1.chargerStatus === 'On'), // ON/OFF Button
          this.setCapabilityValue('aura1CurrentLimit', this.aura.port1.current),
          this.setCapabilityValue('aura1RFIDStatus', this.aura.port1.RFID ? 'On' : 'Off'),
          this.setCapabilityValue('aura1RFIDButton', this.aura.port1.RFID),
          this.setCapabilityValue('aura1CableLockStatus', this.aura.port1.cableLock ? 'On' : 'Off'),
          this.setCapabilityValue('aura1CableLockButton', this.aura.port1.cableLock),
        ]);

      } catch (error) {
        this.logMessage('error', 'Error encountered:', error);
      }
    } else {
      this.logMessage('trace', 'Action not allowed: Charger 1 info can only be retrieved when portAccess is "both" or "port1".');
      await this.setCapabilityValue('aura1CurrentLimit', 0);
      await this.setCapabilityValue('aura1RFIDStatus', 'Off');
      await this.setCapabilityValue('aura1onoffStatus', 'Off');
      await this.setCapabilityValue('aura1CableLockStatus', 'Off');
    }
    await this.getCharger2Info();
  }

  /***********************************************************************************************************
   * Retrieves and updates the information for Charger 2 if the port access is valid.
   * 
   * This method checks if the `portAccess` property is either 'both' or 'port2'. If valid, it fetches the charger information
   * for Charger 2 from the API and updates the corresponding properties and capabilities. If the port access is not valid,
   * it sets the capabilities to their default 'Off' or '0' values.
   **********************************************************************************************************/
  async getCharger2Info() {
    if (this.portAccess === 'both' || this.portAccess === 'port2') {
      this.logMessage('normal', 'Getting Charger 2 info has been initialized');
      try {
        let response = await this.api().get(`/chargepoints/${this.chargeAmpsId}/connectors/2/settings`, {
          headers: {
            Authorization: `Bearer ${this.chargeAmpsToken}`,
          },
          timeout: 90000,
        });

        this.logMessage('full', 'API response received for Charger 2:', JSON.stringify(response.data, null, 2));

        this.aura.port2.current = response.data.maxCurrent;
        this.aura.port2.chargerStatus = response.data.mode;
        this.aura.port2.RFID = response.data.rfidLock;
        this.aura.port2.cableLock = response.data.cableLock;

        await Promise.all([
          this.setCapabilityValue('aura2onoffStatus', this.aura.port2.chargerStatus), // Status Indicator
          this.setCapabilityValue('aura2onoffButton', this.aura.port2.chargerStatus === 'On'), // ON/OFF Button
          this.setCapabilityValue('aura2CurrentLimit', this.aura.port2.current),
          this.setCapabilityValue('aura2RFIDStatus', this.aura.port2.RFID ? 'On' : 'Off'),
          this.setCapabilityValue('aura2RFIDButton', this.aura.port2.RFID),
          this.setCapabilityValue('aura2CableLockStatus', this.aura.port2.cableLock ? 'On' : 'Off'),
          this.setCapabilityValue('aura2CableLockButton', this.aura.port2.cableLock),
        ]);

      } catch (error) {
        this.logMessage('error', 'Error encountered:', error);
      } finally {
        await this.getChargingInfo();
      }
    } else {
      this.logMessage('trace', 'Action not allowed: Charger 2 info can only be retrieved when portAccess is "both" or "port2".');
      await this.setCapabilityValue('aura2CurrentLimit', 0);
      await this.setCapabilityValue('aura2RFIDStatus', 'Off');
      await this.setCapabilityValue('aura2onoffStatus', 'Off');
      await this.setCapabilityValue('aura2CableLockStatus', 'Off');
    }
    this.logMessage('normal', 'Finished hourly info collection from ChargeAmps');
  }
}
module.exports = AURADevice;