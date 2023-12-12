'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const pino = require('pino')
const { graphqlRequest, buildComposer } = require('./helper')

test('should handle many-to-many relation linked by an intermediary entity', async (t) => {
  const requests = [
    {
      query: '{ restaurants (where: { id: { in: [90, 91] } }) { name, foods { name } } }',
      expected: { restaurants: [{ name: 'Pizzeria Napoletana', foods: [{ name: 'Pizza margherita' }, { name: 'Pizza boscaiola' }, { name: 'Pizza capricciosa' }] }, { name: 'Ristorante Stellato', foods: [{ name: 'Spaghetti carbonara' }, { name: 'Tagliolini scoglio' }, { name: 'Pici cacio e pepe' }] }] }
    }
    // TODO reverse, nested, nested x n
  ]

  const composerOptions = {
    defaultArgsAdapter: (partialResults) => {
      return { where: { id: { in: partialResults.map(r => r.id) } } }
    },
    addEntitiesResolvers: true,
    logger: pino({ level: 'debug' }),
    entities: {
      'restaurants-subgraph': {
        Restaurant: {
          resolver: { name: 'restaurants' },
          pkey: 'id',
          many: [
            {
              type: 'Food',
              as: 'foods',
              pkey: 'id',
              link: {
                type: 'RestaurantsFoods',
                pkey: 'restaurantId',
                fkey: 'foodId',
                resolver: {
                  name: 'restaurantsFoods',
                  argsAdapter: (restaurantIds) => {
                    return { where: { restaurantId: { in: restaurantIds } } }
                  },
                  partialResults: (restaurants) => {
                    return restaurants.map(r => r.id)
                  }
                }
              },
              subgraph: 'foods-subgraph',
              resolver: {
                name: 'foods',
                argsAdapter: (foodIds) => {
                  return { where: { id: { in: foodIds } } }
                },
                partialResults: (restaurantFoods) => {
                  return restaurantFoods.map(r => r.foodId)
                }
              }
            }
          ]
        }
      },
      'foods-subgraph': {
        Food: {
          resolver: { name: 'foods' },
          pkey: 'id'
        //   many: [
        //     {
        //       type: 'Restaurant',
        //       as: 'restaurants'
        //       // TODO ...
        //     }
        //   ]
        }
      }
    }
  }

  const { service } = await buildComposer(t, ['restaurants-subgraph', 'foods-subgraph'], composerOptions)

  await service.listen()

  for (const request of requests) {
    const response = await graphqlRequest(service, request.query, request.variables)

    console.log(JSON.stringify(response))

    assert.deepStrictEqual(response, request.expected, 'should get expected result from composer service,' +
      '\nquery: ' + request.query +
      '\nexpected' + JSON.stringify(request.expected, null, 2) +
      '\nresponse' + JSON.stringify(response, null, 2))
  }
})
