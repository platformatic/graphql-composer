'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildComposer, graphqlRequest } = require('./helper')

test('should use metaline for adapters', async t => {
  const composerOptions = {
    addEntitiesResolvers: true,
    defaultArgsAdapter: 'where.id.in.$>#id',
    entities: {
      'artists-subgraph': {
        Artist: {
          resolver: { name: 'artists' },
          pkey: 'id',
          many: [
            {
              type: 'Movie',
              as: 'movies',
              pkey: 'id',
              fkey: 'directorId',
              subgraph: 'movies-subgraph',
              resolver: {
                name: 'movies',
                argsAdapter: 'where.directorId.in.$',
                partialResults: '$>#id'
              }
            },
            {
              type: 'Song',
              as: 'songs',
              pkey: 'id',
              fkey: 'singerId',
              subgraph: 'songs-subgraph',
              resolver: {
                name: 'songs',
                argsAdapter: 'where.singerId.in.$',
                partialResults: '$>#id'
              }
            }
          ]
        }
      },
      'movies-subgraph': {
        Movie: {
          resolver: { name: 'movies' },
          pkey: 'id',
          fkeys: [
            {
              type: 'Artist',
              as: 'director',
              field: 'directorId',
              pkey: 'id',
              resolver: {
                name: 'movies',
                argsAdapter: 'where.directorId.in.$>#id',
                partialResults: '$>id.#directorId'
              }
            }
          ],
          many: [
            {
              type: 'Cinema',
              as: 'cinemas',
              pkey: 'id',
              fkey: 'movieIds',
              subgraph: 'cinemas-subgraph',
              resolver: {
                name: 'cinemas',
                argsAdapter: 'where.movieIds.in.$',
                partialResults: '$>#id'
              }
            }
          ]
        }
      },
      'songs-subgraph': {
        Song: {
          resolver: { name: 'songs' },
          pkey: 'id',
          fkeys: [
            {
              type: 'Artist',
              as: 'singer',
              field: 'singerId',
              pkey: 'id',
              resolver: {
                name: 'songs',
                argsAdapter: 'where.singerId.in.$>#id',
                partialResults: '$>id.#singerId'
              }
            }
          ]
        }
      },
      'cinemas-subgraph': {
        Cinema: {
          resolver: { name: 'cinemas' },
          pkey: 'id',
          many: [
            {
              type: 'Movie',
              as: 'movies',
              pkey: 'movieIds',
              fkey: 'id',
              subgraph: 'movies-subgraph',
              resolver: {
                name: 'movies',
                argsAdapter: 'where.id.in.$',
                partialResults: '$>#movieIds'
              }
            }
          ]
        }
      }
    }
  }

  const { service } = await buildComposer(t, ['artists-subgraph', 'movies-subgraph', 'cinemas-subgraph', 'songs-subgraph'], composerOptions)

  await service.listen()

  const requests = [
    {
      query: '{ movies (where: { id: { in: ["10","11","12"] } }) { title, director { lastName } } }',
      expected: { movies: [{ title: 'Interstellar', director: { lastName: 'Nolan' } }, { title: 'Oppenheimer', director: { lastName: 'Nolan' } }, { title: 'La vita é bella', director: { lastName: 'Benigni' } }] }
    },

    {
      query: '{ movies (where: { id: { in: ["10","11","12"] } }) { title, cinemas { name } } }',
      expected: { movies: [{ title: 'Interstellar', cinemas: [{ name: 'Odeon' }, { name: 'Main Theatre' }] }, { title: 'Oppenheimer', cinemas: [] }, { title: 'La vita é bella', cinemas: [{ name: 'Odeon' }, { name: 'Main Theatre' }] }] }
    },

    {
      query: '{ songs (where: { id: { in: [1,2,3] } }) { title, singer { firstName, lastName, profession } } }',
      expected: {
        songs: [
          { title: 'Every you every me', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
          { title: 'The bitter end', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
          { title: 'Vieni via con me', singer: { firstName: 'Roberto', lastName: 'Benigni', profession: 'Director' } }]
      }
    },

    // get all songs by singer
    {
      query: '{ artists (where: { id: { in: ["103","102"] } }) { lastName, songs { title } } }',
      expected: {
        artists: [
          { lastName: 'Benigni', songs: [{ title: 'Vieni via con me' }] },
          { lastName: 'Molko', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] }]
      }
    },

    // query multiple subgraph on the same node
    {
      query: '{ artists (where: { id: { in: ["101","103","102"] } }) { lastName, songs { title }, movies { title } } }',
      expected: {
        artists: [
          { lastName: 'Nolan', songs: [], movies: [{ title: 'Interstellar' }, { title: 'Oppenheimer' }] },
          { lastName: 'Benigni', songs: [{ title: 'Vieni via con me' }], movies: [{ title: 'La vita é bella' }] },
          { lastName: 'Molko', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }], movies: [] }
        ]
      }
    },

    // double nested
    {
      query: '{ artists (where: { id: { in: ["103", "101"] } }) { firstName, songs { title, singer { firstName } } } }',
      expected: { artists: [{ firstName: 'Christopher', songs: [] }, { firstName: 'Brian', songs: [{ title: 'Every you every me', singer: { firstName: 'Brian' } }, { title: 'The bitter end', singer: { firstName: 'Brian' } }] }] }
    },

    // nested and nested
    {
      query: '{ artists (where: { id: { in: ["103"] } }) { songs { singer { firstName, songs { title } } } } }',
      expected: { artists: [{ songs: [{ singer: { firstName: 'Brian', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }, { singer: { firstName: 'Brian', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }] }] }
    },

    // many to many
    {
      query: '{ cinemas (where: { id: { in: ["90", "91", "92"] } }) { movies { title } } }',
      expected: { cinemas: [{ movies: [{ title: 'Interstellar' }, { title: 'La vita é bella' }] }, { movies: [] }, { movies: [{ title: 'La vita é bella' }, { title: 'Interstellar' }] }] }
    },

    // many to many
    {
      query: '{ movies (where: { id: { in: ["10", "11", "12"] } }) { title, cinemas { name } } }',
      expected: { movies: [{ title: 'Interstellar', cinemas: [{ name: 'Odeon' }, { name: 'Main Theatre' }] }, { title: 'Oppenheimer', cinemas: [] }, { title: 'La vita é bella', cinemas: [{ name: 'Odeon' }, { name: 'Main Theatre' }] }] }
    },

    {
      query: '{ artists (where: { id: { in: ["102", "101"] } }) { movies { title, cinemas { name, movies { title } } } } }',
      expected: {
        artists: [{
          movies: [{
            title: 'Interstellar',
            cinemas: [{
              name: 'Odeon',
              movies: [{ title: 'Interstellar' }, { title: 'La vita é bella' }]
            },
            {
              name: 'Main Theatre',
              movies: [{ title: 'La vita é bella' }, { title: 'Interstellar' }]
            }]
          },
          {
            title: 'Oppenheimer',
            cinemas: []
          }]
        },
        {
          movies: [{
            title: 'La vita é bella',
            cinemas: [{
              name: 'Odeon',
              movies: [{ title: 'Interstellar' }, { title: 'La vita é bella' }]
            },
            {
              name: 'Main Theatre',
              movies: [{ title: 'La vita é bella' }, { title: 'Interstellar' }]
            }]
          }]
        }]
      }
    },

    {
      query: '{ movies (where: { id: { in: ["10","11"] } }) { cinemas { name, movies { title, director { lastName} } } } }',
      expected: {
        movies: [{
          cinemas: [{
            name: 'Odeon',
            movies: [
              { title: 'Interstellar', director: { lastName: 'Nolan' } },
              { title: 'La vita é bella', director: { lastName: 'Benigni' } }
            ]
          },
          {
            name: 'Main Theatre',
            movies: [
              { title: 'La vita é bella', director: { lastName: 'Benigni' } },
              { title: 'Interstellar', director: { lastName: 'Nolan' } }
            ]
          }]
        },
        {
          cinemas: []
        }]
      }
    }
  ]

  for (const request of requests) {
    const response = await graphqlRequest(service, request.query, request.variables)

    assert.deepStrictEqual(response, request.expected, 'should get expected result from composer service,' +
      '\nquery: ' + request.query +
      '\nexpected' + JSON.stringify(request.expected, null, 2) +
      '\nresponse' + JSON.stringify(response, null, 2)
    )
  }
})

test('should use default args adapter on many', async t => {
  const composerOptions = {
    addEntitiesResolvers: true,
    defaultArgsAdapter: 'where.directorId.in.$',
    entities: {
      'artists-subgraph': {
        Artist: {
          resolver: {
            name: 'artists',
            argsAdapter: 'where.id.in.$>#id'
          },
          pkey: 'id',
          many: [
            {
              type: 'Movie',
              as: 'movies',
              pkey: 'id',
              fkey: 'directorId',
              subgraph: 'movies-subgraph',
              resolver: {
                name: 'movies',
                // argsAdapter: 'where.directorId.in.$',
                partialResults: '$>#id'
              }
            }
          ]
        }
      },
      'movies-subgraph': {
        Movie: {
          resolver: {
            name: 'movies',
            argsAdapter: 'where.id.in.$>#id'
          },
          pkey: 'id',
          fkeys: [
            {
              type: 'Artist',
              as: 'director',
              field: 'directorId',
              pkey: 'id',
              resolver: {
                name: 'movies',
                argsAdapter: 'where.directorId.in.$>#id',
                partialResults: '$>id.#directorId'
              }
            }
          ]
        }
      }
    }
  }

  const { service } = await buildComposer(t, ['artists-subgraph', 'movies-subgraph', 'cinemas-subgraph', 'songs-subgraph'], composerOptions)

  await service.listen()

  const query = '{ movies (where: { id: { in: ["10","11","12"] } }) { title, director { lastName } } }'
  const expected = { movies: [{ title: 'Interstellar', director: { lastName: 'Nolan' } }, { title: 'Oppenheimer', director: { lastName: 'Nolan' } }, { title: 'La vita é bella', director: { lastName: 'Benigni' } }] }

  const response = await graphqlRequest(service, query)

  assert.deepStrictEqual(response, expected, 'should get expected result from composer service,' +
    '\nquery: ' + query +
    '\nexpected' + JSON.stringify(expected, null, 2) +
    '\nresponse' + JSON.stringify(response, null, 2)
  )
})

test('should use default args adapter on fkeys', async t => {
  const composerOptions = {
    addEntitiesResolvers: true,
    defaultArgsAdapter: 'where.directorId.in.$>#id',
    entities: {
      'artists-subgraph': {
        Artist: {
          resolver: {
            name: 'artists',
            argsAdapter: 'where.id.in.$>#id'
          },
          pkey: 'id',
          many: [
            {
              type: 'Movie',
              as: 'movies',
              pkey: 'id',
              fkey: 'directorId',
              subgraph: 'movies-subgraph',
              resolver: {
                name: 'movies',
                argsAdapter: 'where.directorId.in.$',
                partialResults: '$>#id'
              }
            }
          ]
        }
      },
      'movies-subgraph': {
        Movie: {
          resolver: {
            name: 'movies',
            argsAdapter: 'where.id.in.$>#id'
          },
          pkey: 'id',
          fkeys: [
            {
              type: 'Artist',
              as: 'director',
              field: 'directorId',
              pkey: 'id',
              resolver: {
                name: 'movies',
                // argsAdapter: 'where.directorId.in.$>#id',
                partialResults: '$>id.#directorId'
              }
            }
          ]
        }
      }
    }
  }

  const { service } = await buildComposer(t, ['artists-subgraph', 'movies-subgraph', 'cinemas-subgraph', 'songs-subgraph'], composerOptions)

  await service.listen()

  const query = '{ movies (where: { id: { in: ["10","11","12"] } }) { title, director { lastName } } }'
  const expected = { movies: [{ title: 'Interstellar', director: { lastName: 'Nolan' } }, { title: 'Oppenheimer', director: { lastName: 'Nolan' } }, { title: 'La vita é bella', director: { lastName: 'Benigni' } }] }

  const response = await graphqlRequest(service, query)

  assert.deepStrictEqual(response, expected, 'should get expected result from composer service,' +
    '\nquery: ' + query +
    '\nexpected' + JSON.stringify(expected, null, 2) +
    '\nresponse' + JSON.stringify(response, null, 2)
  )
})
