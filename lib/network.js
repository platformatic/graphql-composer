'use strict'
const { request } = require('undici')
const { getIntrospectionQuery } = require('graphql')
const introspectionQuery = getIntrospectionQuery()

function graphqlRequest ({ url, query, variables }) {
  return request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  })
}

async function fetchSubgraphSchema (server) {
  const composeEndpoint = `${server.host}${server.composeEndpoint}`
  const endpoints = [composeEndpoint]
  let response = await request(composeEndpoint)

  if (response.statusCode !== 200) {
    // fallback to graphqlEndpoint sending introspection query
    const graphqlEndpoint = `${server.host}${server.graphqlEndpoint}`
    endpoints.push(graphqlEndpoint)
    const gqlResponse = await graphqlRequest({ url: graphqlEndpoint, query: introspectionQuery })

    if (gqlResponse.statusCode !== 200) {
      const msg = `Unable to get schema from ${composeEndpoint} (response ${gqlResponse.statusCode}) nor ${graphqlEndpoint} (response ${gqlResponse.statusCode})`
      throw new Error(msg)
    }

    response = gqlResponse
  }

  let introspection

  try {
    const res = await response.body.json()

    if (!res?.data?.__schema) {
      throw new Error('Returned schema did not include __schema key')
    }

    introspection = res.data
  } catch (err) {
    const msg = `Invalid introspection schema received from ${endpoints.join(', ')}`

    throw new Error(msg, { cause: err })
  }

  return introspection
}

async function makeInstanceRequest (query, server) {
  const response = await server.instance.inject({
    url: server.graphqlEndpoint,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    payload: { query }
  })
  return JSON.parse(await response.body)
}

async function makeHttpRequest (query, server) {
  const graphqlEndpoint = `${server.host}${server.graphqlEndpoint}`

  const response = await request(graphqlEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  })
  return await response.body.json()
}

// TODO optimize: add request in subgraph, to avoid the if
async function makeGraphqlRequest (query, server) {
  let r
  if (server.host) {
    r = await makeHttpRequest(query, server)
  } else {
    r = await makeInstanceRequest(query, server)
  }

  const { data, errors } = r

  if (errors) {
    const msg = errors?.[0]?.message ?? 'Unknown subgraph request error'
    throw new Error(msg, { cause: errors })
  }

  return data
}

module.exports = { fetchSubgraphSchema, makeGraphqlRequest }
