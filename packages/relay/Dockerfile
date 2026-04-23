FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

# --- deps stage: just install node_modules for the relay workspace ---
FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/ ./.yarn/
COPY packages/relay/package.json ./packages/relay/package.json
# Minimal workspace manifests needed for yarn to resolve workspace graph.
COPY packages/nextjs/package.json ./packages/nextjs/package.json
COPY packages/foundry/package.json ./packages/foundry/package.json
RUN yarn workspaces focus @se-2/relay

# --- runtime stage ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/relay/node_modules ./packages/relay/node_modules
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/ ./.yarn/
COPY packages/relay ./packages/relay
WORKDIR /app/packages/relay
EXPOSE 4000
CMD ["yarn", "start"]
