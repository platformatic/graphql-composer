'use strict'

const schema = `
  input WhereConditionIn {
    in: [ID!]!
  }

  input ArtistsWhereCondition {
    id: WhereConditionIn
  } 

  type Artist {
    id: ID
    firstName: String
    lastName: String
    profession: String
  }

  type Query {
    artists(where: ArtistsWhereCondition): [Artist]
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
    artists (_, { where }) {
      return Object.values(data.artists)
        .filter(a => where.id.in.includes(String(a.id)))
    }
  }
}

module.exports = { schema, reset, resolvers, data }
