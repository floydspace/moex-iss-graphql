/* eslint-disable @typescript-eslint/no-var-requires */
const { readFileOrUrlWithCache } = require('@graphql-mesh/utils');
const cheerio = require('cheerio');
const assert = require('assert');
const { camelCase, pascalCase, snakeCase } = require('change-case');
const {
  GraphQLFieldConfig,
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLFloat,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} = require('graphql');
const { GraphQLDate, GraphQLDateTime } = require('graphql-iso-date');
const { singular } = require('pluralize');

const TypeMappings = {
  int32: GraphQLInt,
  int64: GraphQLInt,
  string: GraphQLString,
  date: GraphQLDate,
  datetime: GraphQLDateTime,
  double: GraphQLFloat,
  var: GraphQLString,
  number: GraphQLInt,
};

class MoexISSHandler {

  constructor({ config, cache, pubsub }) {
    this.config = config;
    this.cache = cache;
    this.pubsub = pubsub;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  async getMeshSource() {
    const refUrl = `${this.config.baseUrl}/reference/${this.config.reference}`;
    const refContent = await readFileOrUrlWithCache(refUrl, this.cache, { allowUnknownExtensions: true });
    const { path, requiredArgs, blocks } = parseIssReference(refContent);
    let pathWithDefaultArgs = path;
    for (const arg in this.config.defaultArgs) {
      if (this.config.defaultArgs.hasOwnProperty(arg)) {
        pathWithDefaultArgs = pathWithDefaultArgs.replace(`[${arg}]`, this.config.defaultArgs[arg]);
      }
    }
    const metaResult = await readFileOrUrlWithCache(`${this.config.baseUrl}/${pathWithDefaultArgs}.json?iss.meta=on&iss.data=off`, this.cache);

    const qry = blocks.reduce((queries, block) => {
      const replacedBlockName = this.config.queryNameReplaces && this.config.queryNameReplaces[block.name] || block.name;
      const queryName = this.config.prefix
        ? `${camelCase(this.config.prefix)}${pascalCase(replacedBlockName)}`
        : replacedBlockName;
      return {
        ...queries,
        [queryName]: {
          type: new GraphQLList(generateType(queryName, metaResult[block.name].metadata)),
          description: block.description,
          args: generateArguments(requiredArgs, block.args, this.config.defaultArgs),
          resolve: async (_, args) => {
            const url = buildUrl(this.config.baseUrl, path, args, requiredArgs, block.name);
            const [, resultBlocks] = await readFileOrUrlWithCache(url, this.cache);
            return resultBlocks[block.name];
          }
        }
      };
    }, {});

    const query = new GraphQLObjectType({
      name: 'MoexIssQueries',
      fields: () => [qry].reduce((acc, q) => ({...acc, ...q}), {})
    });

    const schema = new GraphQLSchema({ query });

    return { schema };
  }
}

function buildUrl(baseUrl, path, args, requiredArgs, blockName) {
  const queryArgs = { ...args };
  let pathWithArgs = path;
  for (const arg of requiredArgs) {
    pathWithArgs = pathWithArgs.replace(`[${arg}]`, queryArgs[arg]);
    delete queryArgs[arg];
  }

  const queryParams = [
    'iss.meta=off',
    'iss.data=on',
    'iss.json=extended',
    `iss.only=${blockName}`,
    ...Object.keys(queryArgs).map(key => `${key}=${queryArgs[key]}`)
  ].join('&');

  return `${baseUrl}/${pathWithArgs}.json?${queryParams}`;
}

function generateType(queryName, metadata) {
  return new GraphQLObjectType({
    name: pascalCase(singular(queryName)),
    fields: () => Object.keys(metadata).reduce((fields, field) => {
      const type = TypeMappings[metadata[field].type];
      assert(type, 'Unknown type: ' + metadata[field].type);
      return {
        ...fields,
        [snakeCase(field)]: {
          type,
          resolve: parent => normalizeFieldValue(metadata[field].type, parent[field])
        }
      };
    }, {})
  });
}

function generateArguments(requiredArgs, otherArgs, defaultArgs) {
  return {
    ...requiredArgs.reduce((args, arg) => {
      const defaultValue = defaultArgs && defaultArgs[arg];
      return {
        ...args,
        [arg]: { type: defaultValue !== undefined ? GraphQLString : new GraphQLNonNull(GraphQLString), defaultValue }
      };
    }, {}),
    ...otherArgs.reduce((args, arg) => {
      const type = TypeMappings[arg.type];
      assert(type, 'Unknown type: ' + arg.type);
      return {
        ...args,
        [arg.name]: { type, description: arg.description }
      };
    }, {})
  };
}

function normalizeFieldValue(type, value) {
  if (type === 'datetime' && value) {
    return value.trim().replace(' ', 'T') + '+03:00'; // Moscow timezone
  }
  return value;
}

function parseIssReference(body) {
  const $ = cheerio.load(body);
  const path = $('body > h1').text().match(/\/iss\/(.*)/)[1];
  const requiredArgs = parseRequiredArguments(path);
  const blocks = $('body > dl > dt').map((_, blockEl) => {
    const blockMeta = $(blockEl).next();
    return {
      name: $(blockEl).text().split(' ')[0],
      description: blockMeta.find('> pre').text().trim(),
      args: blockMeta.find('> dl > dt').map((__, argEl) => {
        const argMeta = $(argEl).next();
        return {
          name: $(argEl).text(),
          description: argMeta.find('> pre').text().trim(),
          type: argMeta.contents()[argMeta.contents().index(argMeta.find(`strong:contains('Type:')`)) + 1].data,
        };
      }).get()
    };
  }).get();
  return { path, requiredArgs, blocks };
}

function parseRequiredArguments(path) {
  return (path.match(/\[\w+\]/g) || []).map(arg => arg.match(/\w+/g)[0]);
}

module.exports = MoexISSHandler;
