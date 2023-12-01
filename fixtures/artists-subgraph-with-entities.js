'use strict'

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
    pkey: 'id',
    many: [
      {
        type: 'Movie',
        as: 'movies',
        pkey: 'id',
        fkey: 'directorId',
        subgraph: 'movies-subgraph',
        resolver: {
          name: 'getMoviesByArtists',
          argsAdapter: (artistIds) => {
            return { ids: artistIds }
          },
          partialResults: (partialResults) => {
            return partialResults.map(r => r.id)
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
          name: 'getSongsByArtists',
          argsAdapter: (artistIds) => {
            return { ids: artistIds }
          },
          partialResults: (partialResults) => {
            return partialResults.map(r => r.id)
          }
        }
      }
    ]
  }
}

module.exports = { name: 'artists', schema, reset, resolvers, entities, data }
