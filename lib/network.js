'use strict'
const { request } = require('undici')
const { getIntrospectionQuery } = require('graphql')
const introspectionQuery = getIntrospectionQuery()
const composeEndpointMissCache = new Map()

function composeCacheKey (server) {
  return `${server.host}|${server.composeEndpoint}|${server.graphqlEndpoint}`
}

function graphqlRequest ({ url, headers, query, variables }) {
  return request(url, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  })
}

async function fetchSubgraphSchema (server) {
  const composeEndpoint = `${server.host}${server.composeEndpoint}`
  const graphqlEndpoint = `${server.host}${server.graphqlEndpoint}`
  const endpoints = []
  const cacheKey = composeCacheKey(server)
  let response

  if (!composeEndpointMissCache.has(cacheKey)) {
    response = await request(composeEndpoint)
    endpoints.push(composeEndpoint)
  }

  if (!response || response.statusCode !== 200) {
    if (response && response.statusCode === 404) {
      composeEndpointMissCache.set(cacheKey, true)
    }

    // fallback to graphqlEndpoint sending introspection query
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

async function makeGraphqlRequest ({ server, headers, query }) {
  const graphqlEndpoint = `${server.host}${server.graphqlEndpoint}`
  const gqlResponse = await graphqlRequest({
    url: graphqlEndpoint,
    headers,
    query
  })

  const res = await gqlResponse.body.json()
  // check if exception was thrown by the subgraph
  if (res.error) {
    const msg = res.message ?? res.error ?? 'Unknown subgraph request error'
    throw new Error(msg, { cause: res })
  }

  const { data, errors } = res
  if (errors) {
    const msg = errors?.[0]?.message ?? 'Unknown subgraph request error'
    throw new Error(msg, { cause: errors })
  }

  return data
}

module.exports = { fetchSubgraphSchema, makeGraphqlRequest }
