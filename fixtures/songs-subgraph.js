'use strict'

const schema = `
  input WhereConditionIn {
    in: [ID!]!
  }

  input SongsWhereCondition {
    id: WhereConditionIn
    singerId: WhereConditionIn
  } 

  type Song {
    id: ID!
    title: String
    singerId: ID
  }

  type Query {
    songs(where: SongsWhereCondition): [Song]
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
    async songs (_, { where }) {
      const filter = where.id
        ? (song) => where.id.in.includes(String(song.id))
        : (song) => where.singerId.in.includes(String(song.singerId))
      return Object.values(data.songs)
        .filter(s => filter(s))
    }
  }
}

module.exports = { name: 'songs-subgraph', schema, reset, resolvers, data }
