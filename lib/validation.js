'use strict'
const { isObject } = require('./utils')

function validateArray (value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`)
  }
}

function validateFunction (value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} must be a function`)
  }
}

function validateObject (value, name) {
  if (!isObject(value)) {
    throw new TypeError(`${name} must be a string`)
  }
}

function validateString (value, name) {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`)
  }
}

function validateResolver (resolver, name) {
  validateString(resolver.name, name + '.name')
  if (resolver.argsAdapter) {
    validateFunction(resolver.argsAdapter, name + '.argsAdapter')
  }
  if (resolver.partialResults) {
    validateFunction(resolver.partialResults, name + '.partialResults')
  }
}

module.exports = {
  validateArray,
  validateFunction,
  validateObject,
  validateString,
  validateResolver
}
