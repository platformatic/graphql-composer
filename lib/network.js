'use strict'
const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const { request } = require('undici')
const { WebSocket } = require('ws')

async function fetchSubgraphSchema (server) {
  const endpoint = `${server.host}${server.composeEndpoint}`
  const response = await request(endpoint)

  if (response.statusCode !== 200) {
    const msg = `Subgraph responded with status code ${response.statusCode}`

    throw new Error(msg)
  }

  let introspection

  try {
    const res = await response.body.json()

    if (!res?.data?.__schema) {
      throw new Error('Returned schema did not include __schema key')
    }

    introspection = res.data
  } catch (err) {
    const msg = `Invalid introspection schema received from '${endpoint}'`

    throw new Error(msg, { cause: err })
  }

  return introspection
}

async function makeGqlRequest (query, server) {
  const gqlEndpoint = `${server.host}${server.gqlEndpoint}`
  const response = await request(gqlEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query })
  })
  const { data, errors } = await response.body.json()

  if (errors) {
    const msg = errors?.[0]?.message ?? 'Unknown subgraph request error'

    throw new Error(msg, { cause: errors })
  }

  return data
}

const kConnectionInitMsg = JSON.stringify({ type: 'connection_init' })

class SubscriptionClient extends EventEmitter {
  constructor (wsUrl) {
    super()
    this.url = wsUrl
    this.ws = null
  }

  async subscribe (query) {
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const msg = JSON.stringify({
        id,
        type: 'start',
        payload: { query }
      })

      this.ws.send(msg, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve(id)
        }
      })
    })
  }

  async connect () {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, 'graphql-ws')
      let settled = false

      function settle (err) {
        if (settled) {
          if (err) {
            this.emit('error', err)
          }

          return
        }

        settled = true

        if (err) {
          reject(err)
        } else {
          resolve()
        }
      }

      ws.addEventListener('error', (err) => {
        settle(err)
      })

      ws.addEventListener('close', () => settle())

      ws.addEventListener('message', (msg) => {
        const data = JSON.parse(msg.data)

        if (data.type === 'connection_ack') {
          settle()
        } else {
          this.emit('message', data.payload.data)
        }
      })

      ws.addEventListener('open', () => {
        ws.send(kConnectionInitMsg, (err) => {
          if (err) {
            settle(err)
          }
        })
      })

      this.ws = ws
    })
  }

  async close () {
    return new Promise((resolve) => {
      this.ws?.close()
      resolve()
    })
  }
}

module.exports = { fetchSubgraphSchema, makeGqlRequest, SubscriptionClient }
