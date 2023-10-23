'use strict'

const assert = require('node:assert')
const { test } = require('node:test')

const { compose } = require('../lib')
const { startGraphqlService } = require('./helper')

test('should get sdl from composer', async (t) => {
  const services = [
    {
      schema: `
      type Query {
        add(x: Int, y: Int): Int
      }`,
      resolvers: { Query: { add: (_, { x, y }) => x + y } }
    },
    {
      schema: `
      type Query {
        mul(a: Int, b: Int): Int
      }`,
      resolvers: { Query: { mul: (_, { a, b }) => a * b } }
    },
    {
      schema: `
      type Query {
        sub(x: Int, y: Int): Int
      }`,
      resolvers: { Query: { sub: (_, { x, y }) => x - y } }
    }]
  const expectedSdl = 'type Query {\n' +
    '  add(x: Int, y: Int): Int\n' +
    '  mul(a: Int, b: Int): Int\n' +
    '  sub(x: Int, y: Int): Int\n' +
    '}'

  for (const service of services) {
    const instance = await startGraphqlService(t, {
      mercurius: {
        schema: service.schema,
        resolvers: service.resolvers
      },
      exposeIntrospection: {
        path: '/get-introspection'
      }
    })
    service.host = await instance.listen()
  }

  const composer = await compose({
    subgraphs: services.map(service => (
      {
        server: {
          host: service.host,
          composeEndpoint: '/get-introspection',
          graphqlEndpoint: '/graphql'
        }
      }
    ))
  })

  await startGraphqlService(t, {
    schema: composer.toSdl(),
    resolvers: composer.resolvers
  })

  assert.strictEqual(expectedSdl, composer.toSdl())
})

test('should handle partial subgraphs', async (t) => {
  const services = [
    {
      schema: 'type Query { add(x: Int, y: Int): Int }',
      resolvers: { Query: { add: (_, { x, y }) => x + y } }
    },
    {
      schema: 'type Query { mul(a: Int, b: Int): Int }',
      resolvers: { Query: { mul: (_, { a, b }) => a * b } }
    },
    {
      schema: 'type Query { sub(x: Int, y: Int): Int }',
      resolvers: { Query: { sub: (_, { x, y }) => x - y } }
    }]

  for (const service of services) {
    service.instance = await startGraphqlService(t, {
      mercurius: {
        schema: service.schema,
        resolvers: service.resolvers
      },
      exposeIntrospection: {
        path: '/get-introspection'
      }
    })
    service.host = await service.instance.listen()
  }
  const expectedSdl1 = 'type Query {\n' +
    '  add(x: Int, y: Int): Int\n' +
    '  mul(a: Int, b: Int): Int\n' +
    '  sub(x: Int, y: Int): Int\n' +
    '}'
  const expectedSdl2 = 'type Query {\n' +
    '  mul(a: Int, b: Int): Int\n' +
    '  sub(x: Int, y: Int): Int\n' +
    '}'

  {
    const composer = await compose({
      subgraphs: services.map(service => (
        {
          server: {
            host: service.host,
            composeEndpoint: '/get-introspection',
            graphqlEndpoint: '/graphql'
          }
        }
      ))
    })
    assert.strictEqual(expectedSdl1, composer.toSdl())
  }

  await services[0].instance.close()

  {
    const composer = await compose({
      subgraphs: services.map(service => (
        {
          server: {
            host: service.host,
            composeEndpoint: '/get-introspection',
            graphqlEndpoint: '/graphql'
          }
        }
      ))
    })
    assert.strictEqual(expectedSdl2, composer.toSdl())
  }
})

test('should handle all the unreachable subgraphs', async (t) => {
  const composer = await compose({
    subgraphs: [
      {
        server: {
          host: 'http://unreachable.local'
        }
      }
    ]
  })
  assert.strictEqual('', composer.toSdl())
  assert.deepStrictEqual(Object.create(null), composer.resolvers)
})

test('should fire onSubgraphError retrieving subgraphs from unreachable services', async (t) => {
  const services = [
    {
      off: true,
      schema: 'type Query { add(x: Int, y: Int): Int }',
      resolvers: { Query: { add: (_, { x, y }) => x + y } }
    },
    {
      off: true,
      schema: 'type Query { mul(a: Int, b: Int): Int }',
      resolvers: { Query: { mul: (_, { a, b }) => a * b } }
    },
    {
      schema: 'type Query { sub(x: Int, y: Int): Int }',
      resolvers: { Query: { sub: (_, { x, y }) => x - y } }
    }]
  const expectedSdl = 'type Query {\n' +
    '  sub(x: Int, y: Int): Int\n' +
    '}'
  const expectedErrorMessage = "Could not process schema from 'http://unreachable.local/.well-known/graphql-composition'"

  for (const service of services) {
    if (service.off) {
      service.host = 'http://unreachable.local'
      continue
    }
    service.instance = await startGraphqlService(t, {
      mercurius: {
        schema: service.schema,
        resolvers: service.resolvers
      }
    })
    service.host = await service.instance.listen()
  }

  let errors = 0
  const composer = await compose({
    subgraphs: services.map(service => (
      {
        server: {
          host: service.host
        }
      }
    )),
    onSubgraphError: ({ error }) => {
      assert.strictEqual(expectedErrorMessage, error.message)
      errors++
    }
  })

  assert.strictEqual(errors, 2)
  assert.strictEqual(expectedSdl, composer.toSdl())
})
