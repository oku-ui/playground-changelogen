import { execSync } from 'node:child_process'
import { $fetch } from 'ofetch'
import { inc } from 'semver'
import { generateMarkDown, loadChangelogConfig } from 'changelogen'
import { determineBumpType, getLatestCommits, loadWorkspace } from './_utils'

async function main() {
  const workspace = await loadWorkspace(process.cwd())
  const config = await loadChangelogConfig(process.cwd())
  console.log(config)
  const commits = await getLatestCommits().then(commits => commits.filter(
    c => config.types[c.type] && !(c.type === 'chore' && c.scope === 'deps' && !c.isBreaking),
  ))
  const bumpType = await determineBumpType()

  const newVersion = inc(workspace.workspacePkg.data.version, bumpType || 'patch')
  const changelog = await generateMarkDown(commits, config)
  console.log(newVersion, 'newVersion')
  console.log(changelog, 'changelog')

  // Create and push a branch with bumped versions if it has not already been created
  const branchExists = execSync(`git ls-remote --heads origin v${newVersion}`).toString().trim().length > 0
  if (!branchExists) {
    execSync('git config --global user.email "hi@productdevbook.com"')
    execSync('git config --global user.name "productdevbook"')
    execSync(`git checkout -b v${newVersion}`)

    workspace.setVersion(newVersion!)

    await workspace.save()

    execSync(`git commit -am v${newVersion}`)
    execSync(`git push -u origin v${newVersion}`)
  }

  // Get the current PR for this release, if it exists
  const [currentPR] = await $fetch(`https://api.github.com/repos/oku-ui/playground-changelogen/pulls?head=oku-ui:v${newVersion}`)

  const releaseNotes = [
    currentPR?.body.replace(/## 👉 Changelog[\s\S]*$/, '') || `> ${newVersion} is the next ${bumpType} release.\n>\n> **Timetable**: to be announced.`,
    '## 👉 Changelog',
    changelog.replace(/^## v.*?\n/, '').replace('...main', `...v${newVersion}`),
  ].join('\n')

  // Create a PR with release notes if none exists
  if (!currentPR) {
    return await $fetch('https://api.github.com/repos/oku-ui/playground-changelogen/pulls', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: {
        title: `v${newVersion}`,
        head: `v${newVersion}`,
        base: 'main',
        body: releaseNotes,
        draft: true,
      },
    })
  }
  console.log(currentPR.number, 'currentPR.number')
  console.log(releaseNotes, 'releaseNotes')
  console.log('')
  // Update release notes if the pull request does exist
  try {
     await $fetch(`https://api.github.com/repos/oku-ui/playground-changelogen/pulls/${currentPR.number}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: {
      body: releaseNotes,
    },
  })
  } catch (error) {
    console.log(error)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
