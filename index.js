const config = require('config')
const debug = require('debug')('gerrit-monitor')
const cron = require('node-cron')

const slackConfigured =
  config.has('slack') &&
  config.has('slack.enabled') &&
  config.slack.enabled &&
  config.has('slack.webhookUrl')

if (slackConfigured) {
  const { IncomingWebhook } = require('@slack/webhook')
  let webhook = new IncomingWebhook(config.slack.webhookUrl)

  const reportEmpty =
    config.has('cron') && config.cron.has('reportEmpty')
      ? config.cron.reportEmpty
      : false

  const DEFAULT_FREQUENCY = 30 // Number of minutes between checks

  const Gerrit = require('./gerrit-lib')
  const gLib = new Gerrit()

  const freq =
    config.has('cron') &&
    config.has('cron.frequency') &&
    typeof config.cron.frequency === 'number'
      ? config.cron.frequency
      : DEFAULT_FREQUENCY

  debug(`freq: ${freq}`)

  cron.schedule(`*/${freq} * * * *`, () => {
    gLib.fetchAndLog().then(async (x) => {
      debug(`done with `, x)
      let result = gLib.delta()

      // gLib.delta().then(async (result) => {
      let d = new Date().toLocaleString('en', { timeZoneName: 'short' })
      debug(`${d} delta result: `, result)
      if (result.count || reportEmpty) {
        if (result.count) {
          let msg = `*Urgent Patch Delta Report* @ ${d}: ${
            reportEmpty ? `\nReporting Empty: yes` : ''
          }${
            (result && result.add && result.add.length) || reportEmpty
              ? `\n:fire: Added: ${result.add.join(',')}`
              : ''
          } ${
            (result && result.drop && result.drop.length) || reportEmpty
              ? `\n:checkered_flag: Dropped: ${result.drop.join(',')}`
              : ''
          }`
        }
        let headerBlock = {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Urgent Patch Delta Report* @ ${d}`,
          },
        }
        let addBlock =
          result.add && result.add.length
            ? {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Added*\n${`:fire:` + result.add.join('\n:fire:')}\n`,
                },
              }
            : false

        let dropBlock =
          result.drop && result.drop.length
            ? {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Dropped*\n${
                    `:checkered_flag:` + result.drop.join('\n:checkered_flag:')
                  }\n`,
                },
              }
            : false

        if (addBlock || dropBlock || reportEmpty) {
          blocks = [headerBlock]
          if (addBlock || dropBlock) {
            if (addBlock) blocks.push(addBlock)
            if (dropBlock) blocks.push(dropBlock)
          } else {
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `Nothing added or dropped\n(Sending empty notification per reportEmpty config value)`,
              },
            })
          }

          await webhook.send({
            blocks: blocks,
          })
        } else {
          debug(`No items added or dropped, so not sending Slack msg`)
        }
      }
    })
  })
} else {
  console.error(
    `Slack must be configured and enabled.
    i.e. 'config.slack.enabled = true'
    and 'config.slack.webhookUrl' must be set`
  )
}

function formatUrgent(data, icon = false) {
  const results = ['\n']
  data.forEach((d) => {
    results.push(
      `${icon ? `:${icon}:` : ''}<${config.gerritUrlBase}/${d.id}|${d.id}>: ${
        d.subject
      } (${
        config.has('slack') &&
        config.slack.has('users') &&
        Object.keys(config.slack.users).includes(d.email)
          ? `<@${config.slack.users[d.email]}>`
          : `${d.owner} ${d.email}`
      }; ${d.vScore})`
    )
  })
  return results.join('\n')
}
