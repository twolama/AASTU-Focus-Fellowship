import path from "path";
import mongoose from "mongoose";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const shouldMarkRequired = (value) => {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (typeof value.required === "boolean") {
    return value.required;
  }

  if (Array.isArray(value.required)) {
    return Boolean(value.required[0]);
  }

  return false;
};

const mapMongooseTypeToOpenApi = (type) => {
  if (type === String) return { type: "string" };
  if (type === Number) return { type: "number" };
  if (type === Boolean) return { type: "boolean" };
  if (type === Date) return { type: "string", format: "date-time" };
  if (type === mongoose.Schema.Types.ObjectId) {
    return { type: "string", format: "objectId" };
  }
  if (type === mongoose.Schema.Types.Mixed) return { type: "object" };
  if (type === Object) return { type: "object" };

  return { type: "string" };
};

const convertDefinitionToSchema = (definition, options = {}) => {
  if (Array.isArray(definition)) {
    const firstItem = definition.length > 0 ? definition[0] : { type: String };
    return {
      type: "array",
      items: convertDefinitionToSchema(firstItem, options),
    };
  }

  if (definition instanceof mongoose.Schema) {
    return buildSchemaObjectFromDefinition(definition.obj, options);
  }

  if (!definition || typeof definition !== "object") {
    return { type: "string" };
  }

  if (definition.type) {
    const typeDef = definition.type;

    if (Array.isArray(typeDef)) {
      return {
        type: "array",
        items: convertDefinitionToSchema(
          typeDef[0] || { type: String },
          options,
        ),
      };
    }

    let result;

    if (typeDef && typeof typeDef === "object" && !typeDef.name) {
      result = buildSchemaObjectFromDefinition(typeDef, options);
    } else {
      result = mapMongooseTypeToOpenApi(typeDef);
    }

    if (Array.isArray(definition.enum) && definition.enum.length > 0) {
      result.enum = definition.enum;
    }

    if (typeof definition.minlength === "number") {
      result.minLength = definition.minlength;
    }

    if (typeof definition.maxlength === "number") {
      result.maxLength = definition.maxlength;
    }

    if (typeof definition.min === "number") {
      result.minimum = definition.min;
    }

    if (typeof definition.max === "number") {
      result.maximum = definition.max;
    }

    return result;
  }

  return buildSchemaObjectFromDefinition(definition, options);
};

const buildSchemaObjectFromDefinition = (schemaDefinition, options = {}) => {
  const properties = {};
  const required = [];

  for (const [key, value] of Object.entries(schemaDefinition || {})) {
    if (
      options.excludeSystemFields &&
      ["_id", "__v", "createdAt", "updatedAt"].includes(key)
    ) {
      continue;
    }

    properties[key] = convertDefinitionToSchema(value, options);

    if (shouldMarkRequired(value)) {
      required.push(key);
    }
  }

  const objectSchema = {
    type: "object",
    properties,
  };

  if (required.length > 0) {
    objectSchema.required = required;
  }

  return objectSchema;
};

const buildModelSchemas = (routeDefinitions = []) => {
  const schemas = {};
  const uniqueModels = new Map();

  for (const routeDef of routeDefinitions) {
    const modelFromRef = routeDef.model;
    if (modelFromRef && modelFromRef.schema && modelFromRef.modelName) {
      uniqueModels.set(modelFromRef.modelName, modelFromRef);
      continue;
    }

    if (
      typeof routeDef.modelName === "string" &&
      routeDef.modelName.length > 0 &&
      mongoose.models[routeDef.modelName]
    ) {
      uniqueModels.set(routeDef.modelName, mongoose.models[routeDef.modelName]);
    }
  }

  for (const [modelName, model] of uniqueModels.entries()) {
    if (!model || !model.schema) {
      continue;
    }

    const modelSchema = buildSchemaObjectFromDefinition(model.schema.obj, {
      excludeSystemFields: false,
    });
    const modelInputSchema = buildSchemaObjectFromDefinition(model.schema.obj, {
      excludeSystemFields: true,
    });

    schemas[modelName] = modelSchema;
    schemas[`${modelName}Input`] = modelInputSchema;
  }

  return schemas;
};

const normalizeSwaggerPath = (basePath, routePath) => {
  const toStringPath = (value) => {
    if (Array.isArray(value)) {
      return value[0] || "";
    }
    return typeof value === "string" ? value : "";
  };

  const raw = `${toStringPath(basePath)}${toStringPath(routePath)}`;
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/$/, "") || "/";

  // Express params use :id while OpenAPI expects {id}.
  return withoutTrailingSlash.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
};

const buildPathsFromRouters = (routeDefinitions = []) => {
  const paths = {};

  for (const routeDef of routeDefinitions) {
    const { basePath = "", router, tag = "API", modelName, model } = routeDef;
    const resolvedModelName = model?.modelName || modelName;

    if (!router || !Array.isArray(router.stack)) {
      continue;
    }

    for (const layer of router.stack) {
      if (!layer.route || !layer.route.path || !layer.route.methods) {
        continue;
      }

      const fullPath = normalizeSwaggerPath(basePath, layer.route.path);
      const methods = Object.keys(layer.route.methods).filter(
        (method) => layer.route.methods[method],
      );

      if (!paths[fullPath]) {
        paths[fullPath] = {};
      }

      for (const method of methods) {
        const lowerMethod = method.toLowerCase();
        const operation = {
          tags: [tag],
          summary: `${method.toUpperCase()} ${fullPath}`,
          responses: {
            200: { description: "Successful response" },
            400: { description: "Bad request" },
            401: { description: "Unauthorized" },
            500: { description: "Server error" },
          },
        };

        const pathParamMatches = fullPath.match(/\{([A-Za-z0-9_]+)\}/g) || [];
        if (pathParamMatches.length > 0) {
          operation.parameters = pathParamMatches.map((match) => {
            const paramName = match.replace(/[{}]/g, "");
            return {
              name: paramName,
              in: "path",
              required: true,
              schema: { type: "string" },
            };
          });
        }

        if (
          resolvedModelName &&
          ["post", "put", "patch"].includes(lowerMethod)
        ) {
          operation.requestBody = {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${resolvedModelName}Input`,
                },
              },
            },
          };
        } else if (["post", "put", "patch"].includes(lowerMethod)) {
          operation.requestBody = {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                },
              },
            },
          };
        }

        if (
          resolvedModelName &&
          ["get", "post", "put", "patch"].includes(lowerMethod)
        ) {
          const isCollectionGet =
            lowerMethod === "get" &&
            fullPath === normalizeSwaggerPath(basePath, "/");

          operation.responses[200].content = {
            "application/json": {
              schema: isCollectionGet
                ? {
                    type: "array",
                    items: {
                      $ref: `#/components/schemas/${resolvedModelName}`,
                    },
                  }
                : { $ref: `#/components/schemas/${resolvedModelName}` },
            },
          };
        }

        paths[fullPath][lowerMethod] = operation;
      }
    }
  }

  return paths;
};

const createSwaggerSpec = (routeDefinitions = []) => {
  const generatedPaths = buildPathsFromRouters(routeDefinitions);
  const generatedSchemas = buildModelSchemas(routeDefinitions);

  const options = {
    definition: {
      openapi: "3.0.3",
      info: {
        title: "AASTU Focus Fellowship API",
        version: "1.0.0",
        description:
          "API documentation for the AASTU Focus Fellowship backend.",
      },
      servers: [
        {
          url: "/",
          description: "Current backend origin",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
        schemas: generatedSchemas,
      },
    },
    apis: [
      path.resolve(process.cwd(), "app.js"),
      path.resolve(process.cwd(), "routes/*.js"),
    ],
  };

  const jsdocSpec = swaggerJsdoc(options);

  return {
    ...jsdocSpec,
    components: {
      ...(jsdocSpec.components || {}),
      securitySchemes: {
        ...(jsdocSpec.components?.securitySchemes || {}),
      },
      schemas: {
        ...generatedSchemas,
        ...(jsdocSpec.components?.schemas || {}),
      },
    },
    paths: {
      ...generatedPaths,
      ...(jsdocSpec.paths || {}),
    },
  };
};

const setupSwagger = (app, routeDefinitions = []) => {
  const swaggerSpec = createSwaggerSpec(routeDefinitions);

  app.use("/api-docs", (req, res, next) => {
    // Swagger UI injects inline script/style, so relax CSP only for docs.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
    );
    next();
  });

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.get("/api-docs.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
};

export default setupSwagger;
