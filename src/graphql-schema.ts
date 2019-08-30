import * as assert from 'assert';
import axios from 'axios';
import { camelCase, pascalCase, snakeCase } from 'change-case';
import {
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
} from 'graphql';
import { GraphQLDate, GraphQLDateTime } from 'graphql-iso-date';
import { singular } from 'pluralize';

import { Argument, parseIssReference } from './parse-iss-reference';

const BASE_URL = 'https://iss.moex.com/iss';

const TypeMappings: { [key: string]: GraphQLScalarType } = {
  int32: GraphQLInt,
  int64: GraphQLInt,
  string: GraphQLString,
  date: GraphQLDate,
  datetime: GraphQLDateTime,
  double: GraphQLFloat,
  var: GraphQLString,
  number: GraphQLInt,
};

export async function generateSchema(): Promise<GraphQLSchema> {
  const queries = await Promise.all([
    generateQueries(5),
    generateQueries(13, { prefix: 'security' }),
    generateQueries(24, {
      queryNameReplaces: {
        turnoversprevdate: 'turnoversPreviousDate',
        turnoverssectors: 'turnoversSectors',
        turnoverssectorsprevdate: 'turnoversSectorsPreviousDate',
      }
    }),
    generateQueries(28, {
      queryNameReplaces: {
        boardgroups: 'boardGroups',
        securitytypes: 'securityTypes',
        securitygroups: 'securityGroups',
        securitycollections: 'securityCollections',
      }
    }),
    generateQueries(160, { prefix: 'security' }),
    generateQueries(214, { prefix: 'security' }),
    generateQueries(95, {
      prefix: 'engine',
      defaultArgs: { engine: 'stock' },
      queryNameReplaces: {
        turnoversprevdate: 'turnoversPreviousDate',
        turnoverssectors: 'turnoversSectors',
        turnoverssectorsprevdate: 'turnoversSectorsPreviousDate',
      }
    }),
    // generateQueries(40),
    // generateQueries(127),
    // generateQueries(132),
    // generateQueries(191),
    // generateQueries(193),
  ]);

  const query = new GraphQLObjectType({
    name: 'MoexIssQueries',
    fields: () => queries.reduce((acc, q) => ({...acc, ...q}), {} as GraphQLFieldConfigMap<void, void>)
  });

  return new GraphQLSchema({ query });
}

interface GenerateQueriesOptions {
  prefix?: string;
  defaultArgs?: { [key: string]: string };
  queryNameReplaces?: { [key: string]: string };
}

async function generateQueries(ref: number, options?: GenerateQueriesOptions) {
  options = options || {};

  const refUrl = `${BASE_URL}/reference/${ref}`;
  const { data: refContent } = await axios.get(refUrl);
  const { path, requiredArgs, blocks } = parseIssReference(refContent);
  let pathWithDefaultArgs = path;
  for (const arg in options.defaultArgs) {
    if (options.defaultArgs.hasOwnProperty(arg)) {
      pathWithDefaultArgs = pathWithDefaultArgs.replace(`[${arg}]`, options.defaultArgs[arg]);
    }
  }
  const { data: metaResult } = await axios.get(`${BASE_URL}/${pathWithDefaultArgs}.json?iss.meta=on&iss.data=off`);

  return blocks.reduce((queries, block) => {
    const replacedBlockName = options.queryNameReplaces && options.queryNameReplaces[block.name] || block.name;
    const queryName = options.prefix
      ? `${camelCase(options.prefix)}${pascalCase(replacedBlockName)}`
      : replacedBlockName;
    return {
      ...queries,
      [queryName]: {
        type: new GraphQLList(generateType(queryName, metaResult[block.name].metadata)),
        description: block.description,
        args: generateArguments(requiredArgs, block.args, options.defaultArgs),
        resolve: async (_, args) => {
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
            `iss.only=${block.name}`,
            ...Object.keys(queryArgs).map(key => `${key}=${queryArgs[key]}`)
          ].join('&');
          const { data } = await axios.get(`${BASE_URL}/${pathWithArgs}.json?${queryParams}`);
          return data[1][block.name];
        }
      } as GraphQLFieldConfig<void, void>
    };
  }, {} as GraphQLFieldConfigMap<void, void>);
}

function generateType(queryName: string, metadata: any) {
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
    }, {} as GraphQLFieldConfigMap<void, void>)
  });
}

function generateArguments(requiredArgs: string[], otherArgs: Argument[], defaultArgs?: { [key: string]: string }) {
  return {
    ...requiredArgs.reduce((args, arg) => {
      const defaultValue = defaultArgs && defaultArgs[arg];
      return {
        ...args,
        [arg]: { type: defaultValue !== undefined ? GraphQLString : new GraphQLNonNull(GraphQLString), defaultValue }
      };
    }, {} as GraphQLFieldConfigArgumentMap),
    ...otherArgs.reduce((args, arg) => {
      const type = TypeMappings[arg.type];
      assert(type, 'Unknown type: ' + arg.type);
      return {
        ...args,
        [arg.name]: { type, description: arg.description }
      };
    }, {} as GraphQLFieldConfigArgumentMap)
  } as GraphQLFieldConfigArgumentMap;
}

function normalizeFieldValue(type: string, value: any) {
  if (type === 'datetime' && value) {
    return value.trim().replace(' ', 'T') + '+03:00'; // Moscow timezone
  }
  return value;
}
