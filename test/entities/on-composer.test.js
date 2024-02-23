'use strict'

const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { compose } = require('../../lib')
const { Composer } = require('../../lib/composer')
const { createComposerService, createGraphqlServices, graphqlRequest, assertObject } = require('../helper')

test('composer on top', async () => {
  const composerOptions = {
    addEntitiesResolvers: true,
    defaultArgsAdapter: (partialResults) => {
      return { where: { id: { in: partialResults.map(r => r.id) } } }
    },
    entities: {
      Artist: {
        subgraph: 'artists-subgraph',
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
              argsAdapter: (artistIds) => {
                return { where: { directorId: { in: artistIds } } }
              },
              partialResults: (artists) => {
                return artists.map(r => r.id)
              }
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
              argsAdapter: (artistIds) => {
                return { where: { singerId: { in: artistIds } } }
              },
              partialResults: (artists) => {
                return artists.map(r => r.id)
              }
            }
          }
        ]
      },
      Movie: {
        subgraph: 'movies-subgraph',
        resolver: { name: 'movies' },
        pkey: 'id',
        fkeys: [
          {
            type: 'Artist',
            as: 'director',
            field: 'directorId',
            pkey: 'id',
            subgraph: 'artists-subgraph',
            resolver: {
              name: 'artists',
              argsAdapter: (directorIds) => {
                return { where: { id: { in: directorIds.map(r => r.id) } } }
              },
              partialResults: (movies) => {
                return movies.map(r => ({ id: r.directorId }))
              }
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
              argsAdapter: (movieIds) => {
                return { where: { movieIds: { in: movieIds } } }
              },
              partialResults: (movies) => {
                return movies.map(r => r.id)
              }
            }
          }
        ]
      },
      Song: {
        subgraph: 'songs-subgraph',
        resolver: { name: 'songs' },
        pkey: 'id',
        fkeys: [
          {
            type: 'Artist',
            as: 'singer',
            field: 'singerId',
            pkey: 'id',
            subgraph: 'artists-subgraph',
            resolver: {
              name: 'artists',
              argsAdapter: (singerIds) => {
                return { where: { id: { in: singerIds.map(r => r.id) } } }
              },
              partialResults: (songs) => {
                return songs.map(r => ({ id: r.singerId }))
              }
            }
          }
        ]
      },
      Cinema: {
        subgraph: 'cinemas-subgraph',
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
              argsAdapter: (movieIds) => {
                return { where: { id: { in: movieIds } } }
              },
              partialResults: (movies) => {
                return Array.from(new Set([...movies.flat().map(m => m.movieIds).flat()]))
              }
            }
          }
        ]
      }
    }
  }

  await test('should generate entities for composer on top for multiple subgraphs', async t => {
    const expectedSchema = 'type Artist { id: ID, movies: [Movie], songs: [Song] }\n\n' +
      'type Movie { id: ID!, director: Artist, cinemas: [Cinema] }\n\n' +
      'type Song { id: ID!, singer: Artist }\n\n' +
      'type Cinema { id: ID!, movies: [Movie] }\n\n' +
      'type Query {\n' +
      '  _composer: String \n' +
      '}'

    const expectedResolvers = {
      Artist: {},
      Movie: {},
      Song: {},
      Query: { _composer: () => { } }
    }
    const fn = () => {}

    const expectedEntities = {
      Artist: {
        subgraph: 'artists-subgraph',
        resolver: { name: 'artists', argsAdapter: fn },
        pkey: 'id',
        fkeys: [],
        many: [
          {
            type: 'Movie',
            pkey: 'id',
            as: 'movies',
            fkey: 'directorId',
            subgraph: 'movies-subgraph',
            resolver: {
              name: 'movies',
              argsAdapter: fn,
              partialResults: fn
            }
          },
          {
            type: 'Song',
            pkey: 'id',
            as: 'songs',
            fkey: 'singerId',
            subgraph: 'songs-subgraph',
            resolver: {
              name: 'songs',
              argsAdapter: fn,
              partialResults: fn
            }
          }
        ]
      },
      Movie: {
        subgraph: 'movies-subgraph',
        resolver: { name: 'movies', argsAdapter: fn },
        pkey: 'id',
        fkeys: [
          {
            type: 'Artist',
            field: 'directorId',
            as: 'director',
            pkey: 'id',
            subgraph: 'artists-subgraph',
            resolver: {
              name: 'artists',
              argsAdapter: fn,
              partialResults: fn
            }
          }
        ],
        many: [
          {
            type: 'Cinema',
            pkey: 'id',
            as: 'cinemas',
            fkey: 'movieIds',
            subgraph: 'cinemas-subgraph',
            resolver: {
              name: 'cinemas',
              argsAdapter: fn,
              partialResults: fn
            }
          }
        ]
      },
      Song: {
        subgraph: 'songs-subgraph',
        resolver: { name: 'songs', argsAdapter: fn },
        pkey: 'id',
        fkeys: [
          {
            type: 'Artist',
            field: 'singerId',
            as: 'singer',
            pkey: 'id',
            subgraph: 'artists-subgraph',
            resolver: {
              name: 'artists',
              argsAdapter: fn,
              partialResults: fn
            }
          }
        ],
        many: []
      },
      Cinema: {
        subgraph: 'cinemas-subgraph',
        resolver: { name: 'cinemas', argsAdapter: fn },
        pkey: 'id',
        fkeys: [],
        many: [
          {
            type: 'Movie',
            pkey: 'movieIds',
            as: 'movies',
            fkey: 'id',
            subgraph: 'movies-subgraph',
            resolver: {
              name: 'movies',
              argsAdapter: fn,
              partialResults: fn
            }
          }
        ]
      }
    }

    const services = await createGraphqlServices(t, [
      {
        name: 'artists-subgraph',
        file: path.join(__dirname, '../fixtures/artists.js'),
        listen: true
      },
      {
        name: 'movies-subgraph',
        file: path.join(__dirname, '../fixtures/movies.js'),
        listen: true
      },
      {
        name: 'songs-subgraph',
        file: path.join(__dirname, '../fixtures/songs.js'),
        listen: true
      },
      {
        name: 'cinemas-subgraph',
        file: path.join(__dirname, '../fixtures/cinemas.js'),
        listen: true
      }
    ])

    const options = {
      ...composerOptions,
      subgraphs: services.map(service => (
        {
          name: service.name,
          server: { host: service.host }
        }
      ))
    }
    const composer = new Composer(options)
    await composer.compose()

    const { schema, resolvers, entities } = composer.resolveEntities()

    assert.strictEqual(schema, expectedSchema)
    assertObject(resolvers, expectedResolvers)
    assertObject(entities, expectedEntities)
  })

  await test('should generate entities resolvers for composer on top for multiple subgraphs', async t => {
    const services = await createGraphqlServices(t, [
      {
        name: 'artists-subgraph',
        file: path.join(__dirname, '../fixtures/artists.js'),
        listen: true
      },
      {
        name: 'movies-subgraph',
        file: path.join(__dirname, '../fixtures/movies.js'),
        listen: true
      },
      {
        name: 'songs-subgraph',
        file: path.join(__dirname, '../fixtures/songs.js'),
        listen: true
      },
      {
        name: 'cinemas-subgraph',
        file: path.join(__dirname, '../fixtures/cinemas.js'),
        listen: true
      }
    ])

    const options = {
      ...composerOptions,
      subgraphs: services.map(service => (
        {
          name: service.name,
          server: { host: service.host }
        }
      ))
    }

    const { service } = await createComposerService(t, { compose, options })

    const requests = [
      {
        name: 'should query subgraphs entities / fkey #1',
        query: '{ movies (where: { id: { in: ["10","11","12"] } }) { title director { lastName } } }',
        expected: { movies: [{ title: 'Interstellar', director: { lastName: 'Nolan' } }, { title: 'Oppenheimer', director: { lastName: 'Nolan' } }, { title: 'La vita é bella', director: { lastName: 'Benigni' } }] }
      },
      {
        name: 'should query subgraphs entities / fkey #2',
        query: '{ songs (where: { id: { in: [1,2,3] } }) { title, singer { firstName, lastName, profession } } }',
        expected: {
          songs: [
            { title: 'Every you every me', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
            { title: 'The bitter end', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
            { title: 'Vieni via con me', singer: { firstName: 'Roberto', lastName: 'Benigni', profession: 'Director' } }]
        }
      },
      {
        name: 'should query subgraphs entities (many) on the same query',
        query: '{ artists (where: { id: { in: ["101","103","102"] } }) { lastName songs { title } movies { title } } }',
        expected: {
          artists: [
            { lastName: 'Nolan', songs: [], movies: [{ title: 'Interstellar' }, { title: 'Oppenheimer' }] },
            { lastName: 'Benigni', songs: [{ title: 'Vieni via con me' }], movies: [{ title: 'La vita é bella' }] },
            { lastName: 'Molko', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }], movies: [] }
          ]
        }
      },
      {
        name: 'should query subgraphs nested entities (many)',
        query: '{ artists (where: { id: { in: ["103", "101"] } }) { lastName movies { title cinemas { name } } } }',
        expected: {
          artists: [
            {
              lastName: 'Nolan',
              movies: [
                { title: 'Interstellar', cinemas: [{ name: 'Odeon' }, { name: 'Main Theatre' }] },
                { title: 'Oppenheimer', cinemas: [] }]
            },
            {
              lastName: 'Molko',
              movies: []
            }]
        }
      },
      {
        name: 'should query subgraphs nested entities (many and fkey)',
        query: '{ artists (where: { id: { in: ["103"] } }) { songs { singer { firstName, songs { title } } } } }',
        expected: { artists: [{ songs: [{ singer: { firstName: 'Brian', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }, { singer: { firstName: 'Brian', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }] }] }
      },
      {
        name: 'should query subgraphs entities / many #1',
        query: '{ movies (where: { id: { in: ["10","11","12"] } }) { title, cinemas { name } } }',
        expected: { movies: [{ title: 'Interstellar', cinemas: [{ name: 'Odeon' }, { name: 'Main Theatre' }] }, { title: 'Oppenheimer', cinemas: [] }, { title: 'La vita é bella', cinemas: [{ name: 'Odeon' }, { name: 'Main Theatre' }] }] }
      },
      {
        name: 'should query subgraphs entities / many #2',
        query: '{ movies (where: { id: { in: ["10", "11", "12"] } }) { title, cinemas { name } } }',
        expected: { movies: [{ title: 'Interstellar', cinemas: [{ name: 'Odeon' }, { name: 'Main Theatre' }] }, { title: 'Oppenheimer', cinemas: [] }, { title: 'La vita é bella', cinemas: [{ name: 'Odeon' }, { name: 'Main Theatre' }] }] }
      },
      {
        name: 'should query subgraphs entities / many #3',
        query: '{ artists (where: { id: { in: ["103", "101"] } }) { firstName songs { title singer { firstName } } } }',
        expected: { artists: [{ firstName: 'Christopher', songs: [] }, { firstName: 'Brian', songs: [{ title: 'Every you every me', singer: { firstName: 'Brian' } }, { title: 'The bitter end', singer: { firstName: 'Brian' } }] }] }
      },
      {
        name: 'should query subgraphs entities / many #4',
        query: '{ cinemas (where: { id: { in: ["90", "91", "92"] } }) { name movies { title } } }',
        expected: {
          cinemas: [
            {
              name: 'Odeon',
              movies: [
                { title: 'Interstellar' },
                { title: 'La vita é bella' }
              ]
            },
            {
              name: 'Film Forum',
              movies: null
            },
            {
              name: 'Main Theatre',
              movies: [
                { title: 'La vita é bella' },
                { title: 'Interstellar' }
              ]
            }
          ]
        }
      },
      {
        name: 'should query subgraphs entities / nested many #1',
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
        name: 'should query subgraphs entities / nested many #2',
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
      }]

    for (const c of requests) {
      if (!c) { continue }
      await t.test(c.name, async (t) => {
        const result = await graphqlRequest(service, c.query, c.variables)

        assert.deepStrictEqual(result, c.expected, 'should get expected result from composer service,' +
          '\nquery: ' + c.query +
          '\nexpected' + JSON.stringify(c.expected, null, 2) +
          '\nresponse' + JSON.stringify(result, null, 2)
        )
      })
    }
  })
})
