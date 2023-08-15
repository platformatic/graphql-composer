'use strict';
const { isDeepStrictEqual } = require('node:util');
const {
  createEmptyObject,
  unwrapSchemaType,
  valueToArgumentString
} = require('./gql-utils');
const { fetchSubgraphSchema, makeGqlRequest } = require('./network');
const { isObject } = require('./utils');
const {
  validateArray,
  validateObject,
  validateString
} = require('./validation');

class Composer {
  #queryTypeName;
  #mutationTypeName;
  #subscriptionTypeName;
  #subgraphs;
  #types;
  #directives;

  constructor(options) {
    const {
      queryTypeName = 'Query',
      mutationTypeName = 'Mutation',
      subscriptionTypeName = 'Subscription',
      subgraphs = []
    } = options;

    validateString(queryTypeName, 'queryTypeName');
    validateString(mutationTypeName, 'mutationTypeName');
    validateString(subscriptionTypeName, 'subscriptionTypeName');
    validateArray(subgraphs, 'subgraphs');

    const subgraphsCopy = [];

    for (let i = 0; i < subgraphs.length; ++i) {
      const subgraph = subgraphs[i];

      validateObject(subgraph, `subgraphs[${i}]`);

      const { entities, server } = subgraph;

      validateObject(server, `subgraphs[${i}].server`);

      const { host, composeEndpoint, gqlEndpoint } = server;

      validateString(host, `subgraphs[${i}].server.host`);
      validateString(composeEndpoint, `subgraphs[${i}].server.composeEndpoint`);
      validateString(gqlEndpoint, `subgraphs[${i}].server.gqlEndpoint`);

      const entitiesCopy = Object.create(null);

      if (isObject(entities)) {
        const entityNames = Object.keys(entities);

        for (let j = 0; j < entityNames.length; ++j) {
          const name = entityNames[j];
          const value = entities[name];

          validateObject(value, `subgraphs[${i}].entities.${name}`);

          const {
            adapter,
            foreignKeyFields,
            primaryKeyFields,
            referenceListResolverName
          } = value;

          if (typeof adapter !== 'function') {
            throw new TypeError(
              `subgraphs[${i}].entities.${name}.adapter must be a function`
            );
          }

          validateString(
            referenceListResolverName,
            `subgraphs[${i}].entities.${name}.referenceListResolverName`
          );

          if (Array.isArray(foreignKeyFields)) {
            for (let k = 0; k < foreignKeyFields.length; ++k) {
              const field = foreignKeyFields[k];

              validateString(
                field,
                `subgraphs[${i}].entities.${name}.foreignKeyFields[${k}]`
              );
            }
          } else if (foreignKeyFields !== undefined) {
            throw new TypeError(
              `subgraphs[${i}].entities.${name}.foreignKeyFields must be an array`
            );
          }

          if (Array.isArray(primaryKeyFields)) {
            for (let k = 0; k < primaryKeyFields.length; ++k) {
              const field = primaryKeyFields[k];

              validateString(
                field,
                `subgraphs[${i}].entities.${name}.primaryKeyFields[${k}]`
              );
            }
          } else if (primaryKeyFields !== undefined) {
            throw new TypeError(
              `subgraphs[${i}].entities.${name}.primaryKeyFields must be an array`
            );
          }

          if (primaryKeyFields && foreignKeyFields) {
            throw new Error(
              `subgraphs[${i}].entities.${name} cannot specify primary and foreign key`
            );
          }

          if (!primaryKeyFields && !foreignKeyFields) {
            throw new Error(
              `subgraphs[${i}].entities.${name} must specify primary or foreign key`
            );
          }

          entitiesCopy[name] = {
            adapter,
            foreignKeyFields,
            primaryKeyFields,
            referenceListResolverName
          };
        }
      } else if (entities !== undefined) {
        throw new TypeError(`subgraphs[${i}].entities must be an object`);
      }

      // Make a copy of the input so that no tampering occurs at runtime. It
      // also protects against other things like weird getters.
      subgraphsCopy.push({
        server: { host, composeEndpoint, gqlEndpoint },
        entities: entitiesCopy
      });
    }

    this.#queryTypeName = queryTypeName;
    this.#mutationTypeName = mutationTypeName;
    this.#subscriptionTypeName = subscriptionTypeName;
    this.#subgraphs = subgraphsCopy;
    this.#types = new Map();
    this.#directives = new Map();
    this.resolvers = Object.create(null);
  }

  toSchema() {
    const types = [];
    const directives = Array.from(this.#directives.values());
    let queryType = null;
    let mutationType = null;
    let subscriptionType = null;

    if (this.#types.has(this.#queryTypeName)) {
      queryType = { name: this.#queryTypeName };
    }

    if (this.#types.has(this.#mutationTypeName)) {
      mutationType = { name: this.#mutationTypeName };
    }

    if (this.#types.has(this.#subscriptionTypeName)) {
      subscriptionType = { name: this.#subscriptionTypeName };
    }

    for (const value of this.#types.values()) {
      types.push(value.schemaNode);
    }

    return {
      __schema: {
        queryType,
        mutationType,
        subscriptionType,
        types,
        directives
      }
    };
  }

  async compose() {
    const schemas = await this.#fetchSubgraphSchemas();

    for (let i = 0; i < schemas.length; ++i) {
      this.mergeSchema(schemas[i], this.#subgraphs[i]);
    }
  }

  async #fetchSubgraphSchemas() {
    const requests = this.#subgraphs.map((subgraph) => {
      return fetchSubgraphSchema(subgraph.server);
    });
    const responses = await Promise.allSettled(requests);
    const schemas = [];

    for (let i = 0; i < responses.length; ++i) {
      const { status, value: introspection } = responses[i];

      if (status !== 'fulfilled') {
        const { server } = this.#subgraphs[i];
        const endpoint = `${server.host}${server.composeEndpoint}`;
        const msg = `Could not process schema from '${endpoint}'`;

        throw new Error(msg, { cause: responses[i].reason });
      }

      schemas.push(introspection);
    }

    return schemas;
  }

  mergeSchema({ __schema: schema }, subgraph) {
    // TODO(cjihrig): Support renaming types and handling conflicts.
    // TODO(cjihrig): Handle directives too.
    const queryType = schema?.queryType?.name;
    const mutationType = schema?.mutationType?.name;
    const subscriptionType = schema?.subscriptionType?.name;

    if (queryType && !this.#types.has(this.#queryTypeName)) {
      this.#types.set(this.#queryTypeName, {
        schemaNode: createEmptyObject(this.#queryTypeName),
        fieldMap: new Map()
      });
    }

    if (mutationType && !this.#types.has(this.#mutationTypeName)) {
      this.#types.set(this.#mutationTypeName, {
        schemaNode: createEmptyObject(this.#mutationTypeName),
        fieldMap: new Map()
      });
    }

    if (subscriptionType && !this.#types.has(this.#subscriptionTypeName)) {
      this.#types.set(this.#subscriptionTypeName, {
        schemaNode: createEmptyObject(this.#subscriptionTypeName),
        fieldMap: new Map()
      });
    }

    for (let i = 0; i < schema.types.length; ++i) {
      const type = schema.types[i];
      const originalTypeName = type.name;

      if (originalTypeName.startsWith('__')) {
        // Ignore built in types.
        continue;
      }

      let typeName;
      let isOpType = true;

      if (originalTypeName === queryType) {
        typeName = this.#queryTypeName;
      } else if (originalTypeName === mutationType) {
        typeName = this.#mutationTypeName;
      } else if (originalTypeName === subscriptionType) {
        typeName = this.#subscriptionTypeName;
      } else {
        typeName = originalTypeName;
        isOpType = false;
      }

      const existingType = this.#types.get(typeName);

      if (!existingType) {
        this.#types.set(typeName, {
          schemaNode: type,
          fieldMap: new Map()
        });
      }

      if (Array.isArray(type.fields)) {
        const theType = this.#types.get(typeName);
        const { fieldMap } = theType;

        for (let i = 0; i < type.fields.length; ++i) {
          const field = type.fields[i];
          let existingField = fieldMap.get(field.name);

          if (!existingField) {
            existingField = {
              schemaNode: field,
              subgraphs: new Set()
            };
            fieldMap.set(field.name, existingField);
            theType.schemaNode.fields.push(field);
          }

          existingField.subgraphs.add(subgraph);
        }
      }

      if (Array.isArray(type.fields)) {
        for (let i = 0; i < type.fields.length; ++i) {
          const field = type.fields[i];
          const originalFieldName = field.name;
          // const fieldName = subgraph.renameQueries?.[originalFieldName] ?? originalFieldName;
          const fieldName = originalFieldName;

          // TODO(cjihrig): This is a hack. Use a transform visitor for this.
          field.name = fieldName;
          // End hack.

          if (existingType) {
            addFieldToType(existingType, field, subgraph);
          }

          if (isOpType) {
            const resolver = this.#createResolver({
              // TODO(cjihrig): Audit fields included here.
              type,
              field,
              fieldName: originalFieldName,
              upstream: subgraph
            });

            this.resolvers[typeName] ??= Object.create(null);
            this.resolvers[typeName][fieldName] = resolver;
          }
        }
      } else if (existingType &&
                 !isDeepStrictEqual(type, existingType.schemaNode)) {
        // TODO(cjihrig): Revisit this.
        throw new Error(`Duplicate non-entity type: ${typeName}`);
      }
    }
  }

  #createResolver({ type, field, fieldName, upstream }) {
    return async (parent, args, contextValue, info) => {
      const ctx = {
        path: [],
        followups: new Map(),
        result: { [fieldName]: null }
      };
      // TODO(cjihrig): This should be done in a loop over info.fieldNodes.
      const node = info.fieldNodes[0];
      const schemaNode = type.fields.find((f) => {
        return f.name === node.name.value;
      });
      const bareType = unwrapSchemaType(schemaNode.type);
      const objType = this.#types.get(bareType.name);
      const { fieldMap } = objType;
      const query = {
        node,
        schemaNode,
        path: [fieldName],
        type: objType,
        fields: [],
        upstream,
        resolverName: info.fieldName,
        root: true,
        info,
        adapter: null
      };

      for (const field of fieldMap.values()) {
        query.fields.push(field);
      }

      ctx.followups.set(node, query);
      await this.#buildQuery(query, ctx);

      return ctx.result[fieldName];
    }
  }

  async #buildQuery(queryInfo, parentCtx) {
    const ctx = {
      path: parentCtx.path,
      followups: new Map(),
      result: parentCtx.result
    };

    const { info, node, resolverName, root, schemaNode, upstream } = queryInfo;
    const selectionSet = this.#buildSelectionSet(
      queryInfo, ctx, node, schemaNode
    );
    const computedArgs = this.#buildArguments(queryInfo, ctx, node);
    const query = `${info.operation.operation} { ${resolverName}${computedArgs} ${selectionSet} }`;
    console.log(' --> ' + query + '\n');
    const data = await makeGqlRequest(query, upstream.server);

    // TODO(cjihrig): Need to merge arrays properly.
    let result = data[resolverName];
    let mergeAt = ctx.result;
    let mergeParent = null;

    for (let i = 0; i < queryInfo.path.length; ++i) {
      mergeParent = mergeAt;
      mergeParent[queryInfo.path[i]] ??= null;
      mergeAt = mergeAt[queryInfo.path[i]];
    }

    if (!root) {
      if (Array.isArray(mergeAt) && !Array.isArray(result)) {
        console.log('turning it into an array');
        result = [result];
      } else if (!Array.isArray(mergeAt) &&
                 Array.isArray(result) &&
                 result.length === 1) {
        console.log('getting the first element of the array');
        result = result[0];
      }
    }

    // TODO(cjihrig): Need to perform merge with concept of owner.
    if (mergeAt === null) {
      mergeParent[queryInfo.path.at(-1)] = result;
      mergeAt = result;
    } else if (Array.isArray(result)) {
      console.log('HERE!!!!!!!!');
      console.log(mergeParent);
      console.log(mergeAt);
    } else if (isObject(result)) {
      for (const [k, v] of Object.entries(result)) {
        mergeAt[k] = v;
      }
    } else {
      mergeParent[queryInfo.path.at(-1)] = result;
    }

    // TODO(cjihrig): Need to query the primary owner first.
    for (const followup of ctx.followups.values()) {
      const hasUnresolvedFields = followup.fields.some((f) => {
        return !(f.schemaNode.name in mergeAt);
      });

      if (!hasUnresolvedFields) {
        continue;
      }

      await this.#buildQuery(followup, ctx);
    }
  }

  #buildArguments(queryInfo, ctx, node) {
    const length = node.arguments?.length ?? 0;

    if (length === 0) {
      return '';
    }

    const { info, adapter } = queryInfo;

    if (typeof adapter === 'function') {
      let result = ctx.result;

      for (let i = 0; i < queryInfo.path.length; ++i) {
        result = result[queryInfo.path[i]];
      }

      const args = adapter(result);
      // TODO(cjihrig): Validate returned args object.
      const mappedArgs = Object.keys(args).map((argName) => {
        return `${argName}: ${args[argName]}`;
      });

      return `(${mappedArgs.join(', ')})`;
    }

    const mappedArgs = node.arguments.map((a) => {
      let name = a.name.value;
      let value;

      if (a.value.kind === 'Variable') {
        const varName = a.value.name.value;
        const varValue = info.variableValues[varName];
        // const varDef = info.operation.variableDefinitions.find((v) => {
        //   return v.variable.name.value === varName;
        // });
        // TODO(cjihrig): Use varDef to find strings.
        const isString = false;

        if (typeof varValue === 'object') {
          // TODO(cjihrig): Make this recursive and move to its own function.
          const kvs = Object.keys(varValue).map((k) => {
            let v = varValue[k];

            if (typeof v === 'string') {
              v = `"${v}"`;
            }

            return `${k}: ${v}`;
          }).join(', ');

          value = `{ ${kvs} }`;
        } else {
          value = isString ? `"${varValue}"` : varValue;
        }
      } else {
        value = valueToArgumentString(a.value);
      }

      return `${name}: ${value}`;
    });

    return `(${mappedArgs.join(', ')})`;
  }

  #buildSelectionSet(queryInfo, ctx, node, schemaNode) {
    const selections = node.selectionSet?.selections;
    const length = selections?.length ?? 0;

    if (length === 0) {
      return '';
    }

    ctx.path.push(node.name.value);

    const { info, upstream } = queryInfo;
    const bareType = unwrapSchemaType(schemaNode.type);
    const type = this.#types.get(bareType.name);
    const { fieldMap } = type;
    const set = [];
    let keyFields;

    for (let i = 0; i < length; ++i) {
      const s = selections[i];

      if (s.kind === 'FragmentSpread' || s.kind === 'InlineFragment') {
        // TODO(cjihrig): The fragment probably only needs to be expanded if it
        // is defined in the router. If it is defined by the subgraph server, it
        // should know how to handle it.
        const fragment = s.kind === 'FragmentSpread' ?
          info.fragments[s.name.value] : s;

        for (let i = 0; i < fragment.selectionSet.selections.length; ++i) {
          const fragNode = fragment.selectionSet.selections[i];
          let value = fragNode.name.value;

          if (fragNode.selectionSet) {
            // TODO(cjihrig): Need to make this whole branch equivalent to the else branch.
            value += ` ${this.#buildSelectionSet(queryInfo, ctx, fragNode, schemaNode)}`;
          }

          set.push(value);
        }
      } else {
        let value = s.name.value;
        const field = fieldMap.get(value);
        const selectionSchemaNode = field?.schemaNode;

        // Some nodes won't have a schema representation. For example, __typename.
        if (selectionSchemaNode) {
          if (!field.subgraphs.has(upstream)) {
            let existing = ctx.followups.get(node);

            if (existing === undefined) {

              // TODO(cjihrig): Double check the next line.
              const nextUpstream = Array.from(field.subgraphs)[0];
              const typeName = type.schemaNode.name;
              // TODO(cjihrig): Throw if this doesn't exist.
              const entity = nextUpstream.entities[typeName];
              const {
                adapter,
                foreignKeyFields,
                primaryKeyFields,
                referenceListResolverName: resolverName
              } = entity;

              keyFields = primaryKeyFields ?? foreignKeyFields;

              existing = {
                node,
                schemaNode,
                path: ctx.path.slice(),
                type,
                fields: [],
                resolverName,
                root: false,
                upstream: nextUpstream,
                info,
                adapter
              };

              ctx.followups.set(node, existing);
            }

            existing.fields.push(field);
            continue;
          }

          if (s.arguments.length > 0) {
            value += this.#buildArguments(queryInfo, ctx, s);
          }

          if (s.selectionSet) {
            value += ` ${this.#buildSelectionSet(queryInfo, ctx, s, selectionSchemaNode)}`;
          }
        }

        set.push(value);
      }
    }

    ctx.path.pop();

    if (Array.isArray(keyFields)) {
      for (let i = 0; i < keyFields.length; ++i) {
        const keyFieldName = keyFields[i];

        if (!set.includes(keyFieldName)) {
          set.push(keyFieldName);
        }
      }
    }

    return `{ ${set.join(', ')} }`;
  }
}

function addFieldToType(type, field, subgraph) {
  const { schemaNode: schemaType, fieldMap } = type;
  const existingField = fieldMap.get(field.name);

  if (existingField) {
    if (isDeepStrictEqual(field, existingField.schemaNode)) {
      // There is an existing field that is identical to the new field.
      existingField.subgraphs.add(subgraph);
      return;
    }

    // There is an existing field that conflicts with the new one.
    const msg = `Entity '${schemaType.name}' has conflicting types for ` +
      `field '${field.name}'`;

    throw new Error(msg);
  }

  schemaType.fields.push(field);
  fieldMap.set(field.name, {
    schemaNode: field,
    subgraphs: new Set()
  });
}

module.exports = { Composer };
