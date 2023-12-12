'use strict'

const schema = `
  type Movie {
    id: ID!
    title: String
    directorId: ID
  }

  type Query {
    movies(ids: [ID!]!): [Movie]
  }

  type Artist {
    id: ID
    movies: [Movie]
  }

  extend type Movie {
    director: Artist
  }

  extend type Query {
    getArtistsByMovies (ids: [ID!]!): [Artist]
    getMoviesByArtists (ids: [ID!]!): [Movie]
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
    async movies (_, { ids }) {
      return Object.values(data.movies).filter(m => ids.includes(String(m.id)))
    },
    getArtistsByMovies: async (parent, { ids }, context, info) => {
      return ids.map(id => ({ id }))
    },
    getMoviesByArtists: async (parent, { ids }, context, info) => {
      return Object.values(data.movies).filter(m => ids.includes(String(m.directorId)))
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
        as: 'director',
        field: 'directorId',
        pkey: 'id',
        resolver: {
          name: 'getArtistsByMovies',
          argsAdapter: (partialResults) => {
            return { ids: partialResults.map(r => r.id) }
          },
          partialResults: (partialResults) => {
            return partialResults.map(r => ({ id: r.directorId }))
          }
        }
      }
    ]
  }
}

module.exports = { name: 'movies-subgraph', schema, reset, resolvers, entities, data }
