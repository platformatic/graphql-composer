'use strict'
const { Composer } = require('./composer')

async function compose (config, options) {
  const composer = new Composer(config)

  await composer.compose(options)
  return composer
}

module.exports = { compose }
