'use strict'

const assert = require('node:assert')
const path = require('node:path')
const { test } = require('node:test')
const dedent = require('dedent')
const { createGraphqlServices } = require('./helper')
const { Composer } = require('../lib/composer')
const { compose } = require('../')

test.describe('merge schemas', () => {
  test('should get sdl from composer', async (t) => {
    const schemas = [
      {
        schema: `type Query {
          add(x: Int, y: Int): Int
        }`,
        resolvers: { Query: { add: (_, { x, y }) => x + y } }
      },
      {
        schema: `type Query {
          mul(a: Int, b: Int): Int
        }`,
        resolvers: { Query: { mul: (_, { a, b }) => a * b } }
      },
      {
        schema: `type Query {
          sub(x: Int, y: Int): Int
        }`,
        resolvers: { Query: { sub: (_, { x, y }) => x - y } }
      }]
    const expectedSdl = dedent`type Query {
        add(x: Int, y: Int): Int
        mul(a: Int, b: Int): Int
        sub(x: Int, y: Int): Int
      }`

    const services = await createGraphqlServices(t,
      schemas.map(s => ({
        mercurius: { schema: s.schema, resolvers: s.resolvers },
        listen: true
      })))

    const options = {
      subgraphs: services.map(service => ({ server: { host: service.host } }))
    }

    const composer = new Composer(options)
    await composer.compose()

    assert.strictEqual(composer.toSdl(), expectedSdl)
  })

  test('should handle partial subgraphs', async (t) => {
    const schemas = [
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
    const expectedSdl1 = dedent`type Query {
        add(x: Int, y: Int): Int
        mul(a: Int, b: Int): Int
        sub(x: Int, y: Int): Int
      }`
    const expectedSdl2 = dedent`type Query {
        mul(a: Int, b: Int): Int
        sub(x: Int, y: Int): Int
      }`

    const services = await createGraphqlServices(t,
      schemas.map(s => ({
        mercurius: { schema: s.schema, resolvers: s.resolvers },
        listen: true
      })))

    const subgraphs = services.map(service => ({ server: { host: service.host } }))

    {
      let errors = 0
      const composer = await compose({
        onSubgraphError: () => { errors++ },
        subgraphs
      })
      assert.strictEqual(errors, 0)
      assert.strictEqual(expectedSdl1, composer.toSdl())
    }

    await services[0].service.close()

    {
      let errors = 0
      const composer = await compose({
        onSubgraphError: (error) => {
          assert.strictEqual(error.message, `Could not process schema for subgraph '#0' from '${services[0].host}'`)
          assert.match(error.cause.message, /connect ECONNREFUSED/)
          errors++
        },
        subgraphs
      })

      assert.strictEqual(errors, 1)
      assert.strictEqual(expectedSdl2, composer.toSdl())
    }
  })

  test('should handle all the unreachable subgraphs', async (t) => {
    let errors = 0

    const composer = await compose({
      onSubgraphError: (error) => {
        assert.strictEqual(error.message, "Could not process schema for subgraph '#0' from 'http://unreachable.local'")
        assert.match(error.cause.message, /getaddrinfo (ENOTFOUND|EAI_AGAIN) unreachable.local/)
        errors++
      },
      subgraphs: [
        { server: { host: 'http://unreachable.local' } }
      ]
    })

    assert.strictEqual(errors, 1)
    assert.strictEqual(composer.toSdl(), '')
    assert.deepStrictEqual(composer.getResolvers(), {})
  })

  test('should fire onSubgraphError retrieving subgraphs from unreachable services', async (t) => {
    const schemas = [
      {
        host: 'http://unreachable1.local',
        schema: 'type Query { add(x: Int, y: Int): Int }',
        resolvers: { Query: { add: (_, { x, y }) => x + y } }
      },
      {
        host: 'http://unreachable2.local',
        schema: 'type Query { mul(a: Int, b: Int): Int }',
        resolvers: { Query: { mul: (_, { a, b }) => a * b } }
      },
      {
        schema: 'type Query { sub(x: Int, y: Int): Int }',
        resolvers: { Query: { sub: (_, { x, y }) => x - y } }
      }]
    const expectedSdl = dedent`type Query {
      sub(x: Int, y: Int): Int
    }`

    const services = await createGraphqlServices(t,
      schemas.map(s => ({
        host: s.host,
        mercurius: { schema: s.schema, resolvers: s.resolvers },
        listen: true
      })))

    let errors = 0
    const composer = await compose({
      onSubgraphError: () => { errors++ },
      subgraphs: services.map(service => (
        { server: { host: service.config.host ?? service.host } }
      ))
    })

    assert.strictEqual(errors, 2)
    assert.strictEqual(expectedSdl, composer.toSdl())
  })

  test('should handle all the unreachable subgraphs', async (t) => {
    let errors = 0

    const composer = await compose({
      onSubgraphError: (error) => {
        assert.strictEqual(error.message, "Could not process schema for subgraph '#0' from 'http://unreachable.local'")
        errors++
      },
      subgraphs: [
        { server: { host: 'http://unreachable.local' } }
      ]
    })

    assert.strictEqual(errors, 1)
    assert.strictEqual(composer.toSdl(), '')
    assert.deepStrictEqual(composer.getResolvers(), {})
  })

  test('should compose a single subgraph without entities', async t => {
    const expectedSdl = dedent`input WhereConditionIn {
      in: [ID!]!
    }

    input ArtistsWhereCondition {
      id: WhereConditionIn
    }

    type Artist {
      id: ID
      firstName: String
      lastName: String
      profession: String
    }

    type Query {
      artists(where: ArtistsWhereCondition): [Artist]
    }`

    const services = await createGraphqlServices(t, [{
      name: 'artists-subgraph',
      file: path.join(__dirname, 'fixtures/artists.js'),
      listen: true
    }])

    const options = {
      subgraphs: services.map(service => (
        {
          name: service.name,
          server: { host: service.host }
        }
      ))
    }

    const composer = new Composer(options)
    await composer.compose()

    assert.strictEqual(composer.toSdl(), expectedSdl)
  })

  test('should compose multiple subgraphs without entities', async t => {
    const expectedSdl = dedent`input WhereConditionIn {
      in: [ID!]!
    }
    
    input ArtistsWhereCondition {
      id: WhereConditionIn
    }
    
    type Artist {
      id: ID
      firstName: String
      lastName: String
      profession: String
    }
    
    type Query {
      artists(where: ArtistsWhereCondition): [Artist]
      foods(where: FoodsWhereCondition): [Food]
    }
    
    input FoodsWhereCondition {
      id: WhereConditionIn
    }
    
    type Food {
      id: ID!
      name: String
    }`

    const services = await createGraphqlServices(t, [
      {
        name: 'artists-subgraph',
        file: path.join(__dirname, 'fixtures/artists.js'),
        listen: true
      },
      {
        name: 'foods-subgraph',
        file: path.join(__dirname, 'fixtures/foods.js'),
        listen: true
      }
    ])

    const options = {
      subgraphs: services.map(service => (
        {
          name: service.name,
          server: { host: service.host }
        }
      ))
    }

    const composer = new Composer(options)
    await composer.compose()

    assert.strictEqual(composer.toSdl(), expectedSdl)
  })

  // TODO test('should compose a single subgraph with entities')

  // TODO test('should compose multiple subgraphs with entities and entities resolvers on composer')
})
