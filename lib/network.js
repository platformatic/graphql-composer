'use strict'
const { request } = require('undici')

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

module.exports = { fetchSubgraphSchema, makeGqlRequest }
