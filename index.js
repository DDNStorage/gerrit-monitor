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
      debug(`done with ${x}!`)
      let result = gLib.delta()

      // gLib.delta().then(async (result) => {
      let d = new Date().toLocaleString('en', { timeZoneName: 'short' })
      debug(`${d} delta result: `, result)
      if (result.count || reportEmpty) {
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
        await webhook.send({
          type: 'mrkdwn',
          text: msg,
        })
      }

      //   let latestData = gLib.getLatestData()
      //   let prevData = gLib.getPreviousData()

      //   debug(`latestData.length = ${latestData.length}`)
      //   debug(`prevData.length = ${prevData.length}`)

      //   let currentUrgent = gLib._getUrgentPatches(latestData)
      //   let prevUrgent = gLib._getUrgentPatches(prevData)

      //   const prevUrgentUnverified = []

      //   // TODO: Change to Map
      //   prevUrgent.forEach((d) => {
      //     if (d.vScore == -1) {
      //       prevUrgentUnverified.push(d.id)
      //     }
      //   })
      //   const newUnverified = []
      //   currentUrgent.forEach((d) => {
      //     if (d.vScore == -1 && !prevUrgentUnverified.includes(d.id)) {
      //       newUnverified.push(d)
      //     }
      //   })
      //   if (newUnverified.length) {
      //     formatUrgent(newUnverified)
      //   } else {
      //     debug(`newUnverified is empty: ${newUnverified}`)
      //   }
      // })
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
