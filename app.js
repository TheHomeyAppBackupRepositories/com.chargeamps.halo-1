'use strict';
const Homey = require('homey');

class ChargeAmpsApp extends Homey.App {
  async onInit() {
    this.log("ChargeAmps App has been initialized");

  }
}

module.exports = ChargeAmpsApp;
