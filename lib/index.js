'use strict'
const { Composer } = require('./composer')

async function compose (config) {
  const composer = new Composer(config)

  await composer.compose()
  return composer
}

module.exports = { compose }
