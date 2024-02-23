'use strict'

const schema = `
  input WhereConditionIn {
    in: [ID!]!
  }

  input CinemasWhereCondition {
    id: WhereConditionIn
    movieIds: WhereConditionIn
  } 

  type Cinema {
    id: ID!
    name: String
    movieIds: [ID]
  }

  type Query {
    cinemas(where: CinemasWhereCondition): [Cinema]
  }
`

const data = {
  cinemas: null
}

function reset () {
  data.cinemas = {
    90: {
      id: 90,
      name: 'Odeon',
      movieIds: [10, 12]
    },
    91: {
      id: 91,
      name: 'Film Forum',
      movieIds: null
    },
    92: {
      id: 92,
      name: 'Main Theatre',
      movieIds: [12, 10]
    }
  }
}

reset()

const resolvers = {
  Query: {
    cinemas (_, { where }) {
      if (where.id?.in) {
        return Object.values(data.cinemas)
          .filter(a => where.id.in.includes(String(a.id)))
      }
      if (where.movieIds?.in) {
        return Object.values(data.cinemas)
          .filter(c => {
            return c.movieIds
              ? c.movieIds.some(movieId => {
                return where.movieIds.in.includes(String(movieId))
              })
              : false
          })
      }
    }
  }
}

module.exports = { schema, reset, resolvers, data }
