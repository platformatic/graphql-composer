'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const fs = require('node:fs')
const { getIntrospectionQuery } = require('graphql')
const fastify = require('fastify')
const { default: mercurius } = require('mercurius')
const { buildServer } = require('@platformatic/db')
const { compose } = require('../lib')
const { graphqlNetworkRequest } = require('./helper')

async function createPlatformaticDbService(t, { db }) {
  try { fs.unlinkSync(path.join(__dirname, '..', 'fixtures', db, 'db.sqlite')) } catch { }
  const service = await buildServer(path.join(__dirname, '..', 'fixtures', db, 'db.json'))
  service.get('/.well-known/graphql-composition', async function (req, reply) {
    return reply.graphql(getIntrospectionQuery())
  })
  t.after(async () => {
    // try { await service.close() } catch { }
  })

  return service
}

async function createRouter(t, { services, entities }) {
  const composer = await compose({
    subgraphs: services.map(host => ({ server: { host }, entities })),
  })
  const router = fastify({ logger: { level: 'info' } })
  router.register(mercurius, {
    schema: composer.toSdl(),
    resolvers: composer.resolvers,
    graphiql: true
  })
  t.after(async () => {
    // try { await router.close() } catch { }
  })
  return router
}

test('should use a platformatic db service', { skip: true }, async t => {
  const requests = [
    {
      query: '{ movies (limit:1) { title, year }}',
      expected: { movies: [{ title: 'Following', year: 1998 }] }
    },
    {
      query: '{ movies (limit:2, orderBy: [{field: year, direction: DESC }]) { title, year }}',
      expected: { movies: [{ title: 'Oppenheimer', year: 2023 }, { title: 'Tenet', year: 2020 }] }
    },
    {
      query: `{ movies (
        where: { title: { like: "The%" } },
        limit: 1, 
        orderBy: [{field: year, direction: DESC },{field: title, direction: ASC }],
      ) { title, year }}`,
      expected: { movies: [{ title: 'The', year: 2023 }] }
    }
  ]

  const service = await createPlatformaticDbService(t, { db: 'movies' })
  const serviceHost = await service.start()

  const router = await createRouter(t, { services: [serviceHost] })
  const routerHost = await router.listen()

  for (const request of requests) {
    {
      const response = await graphqlNetworkRequest({ query: request.query, variables: request.variables, host: serviceHost })
      assert.deepEqual(response, request.expected, 'should get expected result from db service')
    }
    {
      const response = await graphqlNetworkRequest({ query: request.query, variables: request.variables, host: routerHost })
      assert.deepEqual(response, request.expected, 'should get expected result from router service')
    }
  }
})

test('should use multiple platformatic db services', async t => {
  const requests = [
    // {
    // query: '{ songs { Artists { lastName, profession }}}',
    // expected: {  }
    // }

    // TODO query with variables
    // query getArtistsByIds ($ids:[ID]) { artists (where: { id: { in: $ids } } ) { id } }
    // variables { ids: ['1','2','3']}    
  ]

  const entities = {
    Song: {
      referenceListResolverName: 'songs',
      primaryKeyFields: ['id'],
      // foreignKeyFields: ['singerId'],
      adapter(partialResult) {
        console.log('Song adapter', partialResult)
        return {
          id: partialResult?.id
        }
      }
    },
    Artist: {
      referenceListResolverName: 'artists',
      primaryKeyFields: ['id'],


      referenceListResolver: (args) => {
        console.log('entities Artist referenceListResolver', args)
        return {
          query: '{ artists (where: { id: { in: $ids } } ) { id } }',
          variables: { ids: [args.id] }
        }
      },
      adapter(partialResult) {
        console.log('Artist adapter', partialResult)
        return {
          id: partialResult?.id
        }
      }
    }
  }

  const services = await Promise.all(['movies', 'songs', 'artists'].map(async db => {
    const service = await createPlatformaticDbService(t, { db })
    return service.start()
  }))

  const router = await createRouter(t, { services, entities })
  const routerHost = await router.listen({ port: 3000 })

  for (const request of requests) {
    const response = await graphqlNetworkRequest({ query: request.query, variables: request.variables, host: routerHost })
    assert.deepEqual(response, request.expected, 'should get expected result from router service')
  }
})

// TODO entities
// TODO subscriptions
