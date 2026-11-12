#!/usr/bin/with-contenv bashio

export CLOUD_URL=$(bashio::config 'cloud_url')
bashio::log.info "NexusHA Cloud Bridge baslatiliyor: ${CLOUD_URL}"

exec node /app/agent.js
