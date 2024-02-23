'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const { createComposerService, createGraphqlServices, graphqlRequest } = require('../helper')
const { compose } = require('../../lib')

function artistsSubgraph () {
  const schema = `
  type Artist {
    id: ID
    firstName: String
    lastName: String
    profession: String
  }

  type Query {
    artists(ids: [ID!]!): [Artist]
  }
`

  const data = {
    artists: null
  }

  function reset () {
    data.artists = {
      101: {
        id: 101,
        firstName: 'Christopher',
        lastName: 'Nolan',
        profession: 'Director'
      },
      102: {
        id: 102,
        firstName: 'Roberto',
        lastName: 'Benigni',
        profession: 'Director'
      },
      103: {
        id: 103,
        firstName: 'Brian',
        lastName: 'Molko',
        profession: 'Singer'
      }
    }
  }

  reset()

  const resolvers = {
    Query: {
      artists (_, { ids }) {
        return Object.values(data.artists).filter(a => ids.includes(String(a.id)))
      }
    }
  }

  const entities = {
    Artist: {
      resolver: { name: 'artists' },
      pkey: 'id'
    }
  }

  return { schema, reset, resolvers, entities, data }
}
function songsSubgraphs () {
  const schema = `
    type Song {
      id: ID!
      title: String
      singerId: ID
      singer: Artist
    }
  
    type Artist {
      id: ID
      songs: [Song]
    }

    type Query {
      songs(ids: [ID!]!): [Song]
      artistsSongs(artistIds: [ID]!): [Artist]!
    }  
  `

  const data = {
    songs: null
  }

  function reset () {
    data.songs = {
      1: {
        id: 1,
        title: 'Every you every me',
        singerId: 103
      },
      2: {
        id: 2,
        title: 'The bitter end',
        singerId: 103
      },
      3: {
        id: 3,
        title: 'Vieni via con me',
        singerId: 102
      }
    }
  }

  reset()

  const resolvers = {
    Query: {
      songs (_, { ids }) {
        return Object.values(data.songs).filter(s => ids.includes(String(s.id)))
      },
      artistsSongs (_, { artistIds }) {
        return Object.values(Object.values(data.songs)
          .reduce((artists, song) => {
            if (!artistIds.includes(String(song.singerId))) { return artists }
            if (artists[song.singerId]) {
              artists[song.singerId].songs.push(song)
            } else {
              artists[song.singerId] = {
                id: song.singerId,
                songs: [song]
              }
            }
            return artists
          }, {})
        )
      }
    },
    Song: {
      singer: (parent, args, context, info) => {
        return parent?.singerId ? { id: parent.singerId } : null
      }
    },
    Artist: {
      songs: (parent, args, context, info) => {
        return Object.values(data.songs).filter(a => String(a.singerId) === String(parent.id))
      }
    }
  }

  const entities = {
    Song: {
      resolver: { name: 'songs' },
      pkey: 'id',
      fkeys: [
        {
          type: 'Artist',
          field: 'singerId',
          pkey: 'id',
          subgraph: 'artists-subgraph',
          resolver: {
            name: 'artists',
            partialResults: (partialResults) => {
              return partialResults.map(r => ({ id: r.singerId }))
            }
          }
        }
      ]
    },
    Artist: {
      pkey: 'id',
      resolver: {
        name: 'artistsSongs',
        argsAdapter: (partialResults) => {
          return { artistIds: partialResults.map(r => r?.id) }
        }
      }
    }
  }

  return { schema, reset, resolvers, entities, data }
}

function moviesSubgraph () {
  const schema = `
    type Movie {
      id: ID!
      title: String
      directorId: ID
      director: Artist
    }
  
    type Artist {
      id: ID
      movies: [Movie]
    }

    type Query {
      movies(ids: [ID!]!): [Movie]
      artistsMovies(artistIds: [ID]!): [Artist]!
    }  
  `

  const data = {
    movies: null
  }

  function reset () {
    data.movies = {
      10: {
        id: 10,
        title: 'Interstellar',
        directorId: 101
      },
      11: {
        id: 11,
        title: 'Oppenheimer',
        directorId: 101
      },
      12: {
        id: 12,
        title: 'La vita é bella',
        directorId: 102
      }
    }
  }

  reset()

  const resolvers = {
    Query: {
      movies (_, { ids }) {
        return Object.values(data.movies).filter(m => ids.includes(String(m.id)))
      },
      artistsMovies (_, { artistIds }) {
        return Object.values(Object.values(data.movies)
          .reduce((artists, movie) => {
            if (!artistIds.includes(String(movie.directorId))) { return artists }
            if (artists[movie.directorId]) {
              artists[movie.directorId].movies.push(movie)
            } else {
              artists[movie.directorId] = {
                id: movie.directorId,
                movies: [movie]
              }
            }
            return artists
          }, {})
        )
      }
    },
    Movie: {
      director: (parent, args, context, info) => {
        return parent?.directorId ? { id: parent.directorId } : null
      }
    },
    Artist: {
      movies: (parent, args, context, info) => {
        return Object.values(data.movies).filter(a => String(a.directorId) === String(parent.id))
      }
    }
  }

  const entities = {
    Movie: {
      resolver: { name: 'movies' },
      pkey: 'id',
      fkeys: [
        {
          type: 'Artist',
          field: 'directorId',
          pkey: 'id',
          subgraph: 'artists-subgraph',
          resolver: {
            name: 'artists',
            partialResults: (partialResults) => {
              return partialResults.map(r => ({ id: r.directorId }))
            }
          }
        }
      ]
    },
    Artist: {
      pkey: 'id',
      resolver: {
        name: 'artistsMovies',
        argsAdapter: (partialResults) => {
          return { artistIds: partialResults.map(r => r?.id) }
        }
      }
    }
  }

  return { schema, reset, resolvers, entities, data }
}

test('entities on subgraph, scenario #3: entities with 1-1, 1-2-m, m-2-m relations solved on subgraphs', async (t) => {
  let service

  t.before(async () => {
    const artists = artistsSubgraph()
    const movies = moviesSubgraph()
    const songs = songsSubgraphs()

    const services = await createGraphqlServices(t, [
      {
        name: 'artists-subgraph',
        mercurius: {
          schema: artists.schema,
          resolvers: artists.resolvers
        },
        entities: artists.entities,
        listen: true
      },
      {
        name: 'movies-subgraph',
        mercurius: {
          schema: movies.schema,
          resolvers: movies.resolvers
        },
        entities: movies.entities,
        listen: true
      },
      {
        name: 'songs-subgraph',
        mercurius: {
          schema: songs.schema,
          resolvers: songs.resolvers
        },
        entities: songs.entities,
        listen: true
      }
    ])

    const options = {
      defaultArgsAdapter: (partialResults) => {
        return { ids: partialResults.map(r => r?.id) }
      },
      subgraphs: services.map(service => ({
        name: service.name,
        server: { host: service.host },
        entities: service.config.entities
      }))
    }

    const s = await createComposerService(t, { compose, options })
    service = s.service
  })

  const requests = [
    {
      name: 'should run a query that resolve entities with a 1-to-1 relation',
      query: '{ songs (ids: [1,2,3]) { title, singer { firstName, lastName, profession } } }',
      result: {
        songs: [
          { title: 'Every you every me', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
          { title: 'The bitter end', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
          { title: 'Vieni via con me', singer: { firstName: 'Roberto', lastName: 'Benigni', profession: 'Director' } }]
      }
    },

    {
      name: 'should run a query with double nested results',
      query: '{ artists (ids: ["103"]) { songs { title, singer { firstName, lastName } } } }',
      result: { artists: [{ songs: [{ title: 'Every you every me', singer: { firstName: 'Brian', lastName: 'Molko' } }, { title: 'The bitter end', singer: { firstName: 'Brian', lastName: 'Molko' } }] }] }
    },

    {
      name: 'should run a query that resolve entities with a 1-to-many relation',
      query: '{ artists (ids: ["103","102"]) { lastName, songs { title } } }',
      result: {
        artists: [
          { lastName: 'Benigni', songs: [{ title: 'Vieni via con me' }] },
          { lastName: 'Molko', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] }]
      }
    },

    {
      name: 'should run a query that resolve multiple entities on different subgrapgh on the same node',
      query: '{ artists (ids: ["103","101","102"]) { lastName, songs { title }, movies { title } } }',
      result: {
        artists: [
          { lastName: 'Nolan', songs: null, movies: [{ title: 'Interstellar' }, { title: 'Oppenheimer' }] },
          { lastName: 'Benigni', songs: [{ title: 'Vieni via con me' }], movies: [{ title: 'La vita é bella' }] },
          { lastName: 'Molko', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }], movies: null }
        ]
      }
    },

    {
      name: 'should run a query with insane nested results',
      query: '{ artists (ids: ["103"]) { songs { singer { songs { singer { songs { title } }} } } } }',
      result: { artists: [{ songs: [{ singer: { songs: [{ singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }, { singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }] } }, { singer: { songs: [{ singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }, { singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }] } }] }] }
    }
  ]

  for (const c of requests) {
    await t.test(c.name, async (t) => {
      const result = await graphqlRequest(service, c.query, c.variables)

      assert.deepStrictEqual(result, c.result)
    })
  }
})
