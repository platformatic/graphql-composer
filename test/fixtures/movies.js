'use strict'

const schema = `
  input WhereConditionIn {
    in: [ID!]!
  }

  input MoviesWhereCondition {
    id: WhereConditionIn
    directorId: WhereConditionIn
  } 

  type Movie {
    id: ID!
    title: String
    directorId: ID
  }

  type Query {
    movies(where: MoviesWhereCondition): [Movie]
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
    movies (_, { where }) {
      const filter = where.id
        ? (movie) => where.id.in.includes(String(movie.id))
        : (movie) => where.directorId.in.includes(String(movie.directorId))
      return Object.values(data.movies)
        .filter(s => filter(s))
    }
  }
}

module.exports = { schema, reset, resolvers, data }
