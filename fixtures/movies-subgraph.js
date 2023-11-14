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
    movieArtists (ids: [ID!]!): [Artist]
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
      return Object.values(data.movies).filter(a => ids.includes(String(a.id)))
    },
    movieArtists: async (parent, args, context, info) => {
      return args.ids.map(id => ({ id }))
    }
  },
  Movie: {
    director: (parent, args, context, info) => {
      return parent?.directorId ? { id: parent.directorId } : null
    }
  },
  Artist: {
    // TODO dataloader here
    movies: (parent, args, context, info) => {
      return Object.values(data.songs).filter(a => String(a.directorId) === String(parent.id))
    }
  }
}

const entities = {
  Movie: {
    referenceListResolverName: 'movies',
    keys: [{ field: 'id' }, { field: 'directorId', type: 'Artist' }]
  },
  Artist: {
    referenceListResolverName: 'movieArtists',
    argsAdapter: (partialResults) => {
      return { ids: partialResults.map(r => r.id) }
    },
    keys: [{ field: 'id' }]
  }
}

module.exports = { name: 'movies', schema, reset, resolvers, entities, data }
