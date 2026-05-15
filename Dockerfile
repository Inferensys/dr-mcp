FROM node:22-alpine

RUN npm install -g @inferensys/dr-mcp@0.3.0 \
  && npm cache clean --force

ENTRYPOINT ["dr-mcp"]
CMD ["server"]
