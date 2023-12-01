'use strict'

const schema = `
  type Song {
    id: ID!
    title: String
    singerId: ID
  }

  type Query {
    songs(ids: [ID!]!): [Song]
  }

  type Artist {
    id: ID
    songs: [Song]
  }

  extend type Song {
    singer: Artist
  }

  extend type Query {
    getArtistsBySongs (ids: [ID!]!): [Artist]
    getSongsByArtists (ids: [ID!]!): [Song]
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
    async songs (_, { ids }) {
      return Object.values(data.songs).filter(s => ids.includes(String(s.id)))
    },
    getArtistsBySongs: async (parent, { ids }, context, info) => {
      return ids.map(id => ({ id }))
    },
    getSongsByArtists: async (parent, { ids }, context, info) => {
      return Object.values(data.songs).filter(s => ids.includes(String(s.singerId)))
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
        as: 'singer',
        field: 'singerId',
        pkey: 'id',
        resolver: {
          name: 'getArtistsBySongs',
          argsAdapter: (partialResults) => {
            return { where: { singerId: { in: partialResults.map(r => r.id) } } }
          },
          partialResults: (partialResults) => {
            return partialResults.map(r => ({ id: r.singerId }))
          }
        }
      }
    ]
  }
}

module.exports = { name: 'songs', schema, reset, resolvers, entities, data }
