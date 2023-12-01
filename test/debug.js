'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildComposer, graphqlRequest } = require('./helper')

const composerOptions = {
  defaultArgsAdapter: (partialResults) => {
    return { where: { id: { in: partialResults.map(r => r.id) } } }
  },
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
              argsAdapter: (movieIds) => {
                return { where: { directorId: { in: movieIds.map(r => r.id) } } }
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
              argsAdapter: (songIds) => {
                return { where: { singerId: { in: songIds.map(r => r.id) } } }
              },
              partialResults: (songs) => {
                return songs.map(r => ({ id: r.singerId }))
              }
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
}

test('entities', async () => {
  await test('should generate entities resolvers for composer on top for multiple subgraphs', async t => {
    const options = { ...composerOptions }
    options.addEntitiesResolvers = true

    const { service } = await buildComposer(t, ['artists-subgraph', 'movies-subgraph', 'cinemas-subgraph', 'songs-subgraph'], options)

    await service.listen()

    const requests = [

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
      console.log('\n\n', request.query)
      console.log('-------------')

      const response = await graphqlRequest(service, request.query, request.variables)

      console.log(JSON.stringify(response, null, 2))

      assert.deepStrictEqual(response, request.expected, 'should get expected result from composer service,' +
        '\nquery: ' + request.query +
        '\nexpected' + JSON.stringify(request.expected, null, 2) +
        '\nresponse' + JSON.stringify(response, null, 2)
      )
    }
  })
})
