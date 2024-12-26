'use strict';

const { Driver } = require('homey');
const axios = require('axios');
const LUNADevice = require('./device'); // Se till att rätt klass importeras om den inte redan är det

class LUNADriver extends Driver {

  async onInit() {
    try {
      this.log('LUNADriver has been initialized');
      this.log(`Homey version: ${this.homey.version}`);
    } catch (error) {
      this.error('Error initializing LUNADriver:', error.message, error.stack);
    }
  }

  /**
   * List available devices for pairing
   * This method fetches all owned Charge Amps devices using the API and returns only LUNA devices for pairing in Homey.
   */
  async onPairListDevices() {
    try {
      this.log('Starting onPairListDevices to list available devices for pairing...');

      // Get the token for authenticating API requests
      const chargeAmpsToken = await this.getChargeAmpsToken();

      // Log time before API call
      const startTime = Date.now();

      // Make an API call to get the list of owned devices
      const response = await this.api().get('/chargepoints/owned', {
        headers: {
          Authorization: `Bearer ${chargeAmpsToken}`,
        },
      });

      // Log time after API call
      const endTime = Date.now();
      this.log(`API call to get owned chargepoints took ${endTime - startTime} ms`);

      // Check if we received any devices
      if (!response.data || response.data.length === 0) {
        this.log('No devices found in the response data.');
        return [];
      }

      // Filter devices to only include those of type "LUNA"
      const lunaDevices = response.data.filter(device => device.type === 'LUNA');

      if (lunaDevices.length === 0) {
        this.log('No LUNA devices found.');
        return [];
      }

      // Map the filtered LUNA devices to Homey compatible format for pairing
      const devices = lunaDevices.map((device, index) => {
        this.log(`Processing LUNA device ${index + 1}: ID = ${device.id}, Name = ${device.name}`);

        return {
          name: device.name, // Use the name provided by the API
          data: {
            id: device.id,  // Store the device ID
          },
        };
      });

      this.log(`LUNA devices ready for pairing: ${JSON.stringify(devices)}`);
      return devices;
    } catch (error) {
      this.error('Error listing devices for pairing:', error.message, error.stack);
      return [];
    }
  }

  /**
   * Authenticate and retrieve the Charge Amps API token
   * This method logs in to the Charge Amps API using user credentials and retrieves an authentication token.
   */
  async getChargeAmpsToken() {
    const email = this.homey.settings.get('email');
    const password = this.homey.settings.get('password');
    const apiKey = this.homey.settings.get('APIkey');

    if (!email || !password || !apiKey) {
      this.error('One or more credentials are missing in the settings.');
      throw new Error('One or more credentials are missing in the settings.');
    }

    try {
      const response = await this.api().post('/auth/login', {
        email,
        password,
      }, {
        headers: {
          apiKey,
        },
      });

      return response.data.token;  // Return the token for future API calls
    } catch (error) {
      this.error('Error during login to Charge Amps API:', error.message, error.stack);
      throw error;
    }
  }

  /**
   * Create a new LUNADevice instance
   * This method is called when a new device is added to Homey. It assigns the device data to the new device instance.
   */
  createDevice(deviceData) {
    try {
      // Verify that data and ID exist
      if (!deviceData || !deviceData.id) {
        this.error('Device data is missing or incomplete, cannot create device.');
        throw new Error('Device data is missing or incomplete.');
      }

      // Create the device
      const device = new LUNADevice(this, deviceData);

      // Verify that getData works
      const retrievedData = device.getData();
      if (retrievedData && retrievedData.id === deviceData.id) {
        this.log(`Device data verified: ID = ${retrievedData.id}`);
      } else {
        this.error('Verification failed: Data does not match or is incomplete.');
        throw new Error('Verification failed: Data retrieval issue.');
      }

      this.log(`Device created successfully with ID: ${deviceData.id}`);
      return device;
    } catch (error) {
      this.error('Error creating device:', error.message, error.stack);
      return null;
    }
  }

  /**
   * Create an axios instance for API calls to Charge Amps
   */
  api() {
    this.log('Creating axios instance for Charge Amps API...');
    return axios.create({
      baseURL: 'https://eapi.charge.space/api/v5',
      timeout: 25000,
      headers: {
        'Content-Type': 'application/json',
        accept: '*/*',
      },
    });
  }
}

module.exports = LUNADriver;