'use strict'

const schema = `
  input WhereConditionIn {
    in: [ID!]!
  }

  input FoodsWhereCondition {
    id: WhereConditionIn
  } 

  type Food {
    id: ID!
    name: String
  }

  type Query {
    foods(where: FoodsWhereCondition): [Food]
  }
`

const data = {
  foods: null
}

function reset () {
  data.foods = {
    50: {
      id: 50,
      name: 'Pizza margherita'
    },
    51: {
      id: 51,
      name: 'Pizza boscaiola'
    },
    52: {
      id: 52,
      name: 'Pizza capricciosa'
    },
    60: {
      id: 60,
      name: 'Spaghetti carbonara'
    },
    61: {
      id: 61,
      name: 'Tagliolini scoglio'
    },
    62: {
      id: 62,
      name: 'Pici cacio e pepe'
    },
    63: {
      id: 63,
      name: 'Grigliata mista'
    }
  }
}

reset()

const resolvers = {
  Query: {
    foods (_, { where }) {
      return Object.values(data.foods)
        .filter(a => where.id.in.includes(String(a.id)))
    }
  }
}

module.exports = { schema, reset, resolvers, data }
