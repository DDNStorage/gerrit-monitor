const config = require('config')
const debug = require('debug')('gerrit-alert')
const cron = require('node-cron')

let webhook = false

const slackConfigured =
  config.has('slack') &&
  config.has('slack.enabled') &&
  config.slack.enabled &&
  config.has('slack.webhookUrl')

if (slackConfigured) {
  const { IncomingWebhook } = require('@slack/webhook')
  webhook = new IncomingWebhook(config.slack.webhookUrl)

  const reportEmpty = false
  const DEFAULT_FREQUENCY = 30 // Number of minutes between checks

  const Gerrit = require('./gerrit-lib')
  const gLib = new Gerrit()

  cron.schedule(
    `*/${
      config.has('cron') &&
      config.has('cron.frequency') &&
      typeof value === 'number'
        ? config.cron.frequency
        : DEFAULT_FREQUENCY
    } * * * *`,
    () => {
      gLib.delta().then(async (result) => {
        let d = new Date().toLocaleString('en', { timeZoneName: 'short' })
        debug(`${d} delta result: `, result)
        if (result.count || reportEmpty) {
          let msg = `*Urgent Patch Delta Report* @ ${d}: ${
            reportEmpty ? `\nReporting Empty: yes` : ''
          }${
            result.add.length || reportEmpty
              ? `\n:fire: Added: ${result.add.join(',')}`
              : ''
          } ${
            result.drop.length || reportEmpty
              ? `\n:checkered_flag: Dropped: ${result.drop.join(',')}`
              : ''
          }`
          await webhook.send({
            type: 'mrkdwn',
            text: msg,
          })
        }
      })
    }
  )
} else {
  console.error(
    `Slack must be configured
      i.e.
      config.slack.enabled 
      and
      config.slack.webhookUrl must all be set]`
  )
}
