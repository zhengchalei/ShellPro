use std::collections::HashMap;

use uuid::Uuid;

use crate::models::{AuthType, ConnectionProfile, ConnectionProfileInput};

#[derive(Default)]
struct OpenSshHostBlock {
    aliases: Vec<String>,
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
    proxy_jump: Option<String>,
}

struct ParsedOpenSshProfile {
    input: ConnectionProfileInput,
    proxy_jump: Option<String>,
}

fn has_openssh_wildcard(value: &str) -> bool {
    value.contains('*') || value.contains('?') || value.contains('!')
}

fn proxy_jump_host(value: &str) -> Option<String> {
    let first = value.split(',').next()?.trim();
    if first.is_empty() || first.eq_ignore_ascii_case("none") {
        return None;
    }
    let without_user = first.rsplit('@').next().unwrap_or(first);
    let host = without_user
        .split(':')
        .next()
        .unwrap_or(without_user)
        .trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

fn openssh_words(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .map(|word| word.trim_matches('"').trim_matches('\'').to_string())
        .filter(|word| !word.is_empty())
        .collect()
}

fn profile_input_from_openssh_block(
    block: OpenSshHostBlock,
    existing_profiles: &[ConnectionProfile],
    warnings: &mut Vec<String>,
) -> Option<ParsedOpenSshProfile> {
    let alias = block
        .aliases
        .iter()
        .find(|alias| !has_openssh_wildcard(alias))
        .cloned();
    let Some(alias) = alias else {
        return None;
    };

    let host = block.hostname.unwrap_or_else(|| alias.clone());
    if host.trim().is_empty() {
        warnings.push(format!("Skipped {alias}: host is empty."));
        return None;
    }

    let proxy_jump = block.proxy_jump;
    let jump_host_id = proxy_jump.as_ref().and_then(|value| {
        proxy_jump_host(value).and_then(|jump_host| {
            existing_profiles
                .iter()
                .find(|profile| profile.host == jump_host || profile.name == jump_host)
                .map(|profile| profile.id.clone())
        })
    });

    Some(ParsedOpenSshProfile {
        input: ConnectionProfileInput {
            id: None,
            name: alias,
            host,
            port: block.port.unwrap_or(22),
            username: block.user.unwrap_or_else(|| "root".to_string()),
            auth_type: if block.identity_file.is_some() {
                AuthType::PrivateKey
            } else {
                AuthType::Agent
            },
            private_key_path: block.identity_file,
            group_id: Some("Imported".to_string()),
            tags: vec!["openssh".to_string()],
            jump_host_id,
            favorite: false,
        },
        proxy_jump,
    })
}

pub(crate) fn parse_openssh_config(
    content: &str,
    existing_profiles: &[ConnectionProfile],
) -> (Vec<ConnectionProfileInput>, usize, Vec<String>) {
    let mut parsed_profiles = Vec::new();
    let mut warnings = Vec::new();
    let mut skipped = 0;
    let mut current: Option<OpenSshHostBlock> = None;
    let mut in_match_block = false;

    let flush_current = |current: &mut Option<OpenSshHostBlock>,
                         parsed_profiles: &mut Vec<ParsedOpenSshProfile>,
                         warnings: &mut Vec<String>,
                         skipped: &mut usize| {
        if let Some(block) = current.take() {
            let alias_count = block.aliases.len().max(1);
            if let Some(profile) =
                profile_input_from_openssh_block(block, existing_profiles, warnings)
            {
                parsed_profiles.push(profile);
            } else {
                *skipped += alias_count;
            }
        }
    };

    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let line_without_comment = trimmed.split('#').next().unwrap_or("").trim();
        if line_without_comment.is_empty() {
            continue;
        }
        let mut parts = line_without_comment.splitn(2, char::is_whitespace);
        let keyword = parts.next().unwrap_or("").to_ascii_lowercase();
        let value = parts.next().unwrap_or("").trim();

        match keyword.as_str() {
            "host" => {
                in_match_block = false;
                flush_current(
                    &mut current,
                    &mut parsed_profiles,
                    &mut warnings,
                    &mut skipped,
                );
                let aliases = openssh_words(value);
                if aliases.is_empty()
                    || aliases
                        .iter()
                        .any(|alias| alias == "*" || has_openssh_wildcard(alias))
                {
                    skipped += aliases.len().max(1);
                    current = None;
                    continue;
                }
                current = Some(OpenSshHostBlock {
                    aliases,
                    ..OpenSshHostBlock::default()
                });
            }
            "match" => {
                flush_current(
                    &mut current,
                    &mut parsed_profiles,
                    &mut warnings,
                    &mut skipped,
                );
                in_match_block = true;
                warnings.push(
                    "Skipped Match block; complex OpenSSH conditions are not imported.".to_string(),
                );
            }
            "include" => {
                warnings.push(
                    "Skipped Include directive; import one resolved config file at a time."
                        .to_string(),
                );
            }
            _ if in_match_block => {}
            _ => {
                if let Some(block) = &mut current {
                    match keyword.as_str() {
                        "hostname" => block.hostname = Some(value.to_string()),
                        "user" => block.user = Some(value.to_string()),
                        "port" => match value.parse::<u16>() {
                            Ok(port) if port > 0 => block.port = Some(port),
                            _ => warnings.push(format!(
                                "Skipped invalid port '{value}' for {}.",
                                block.aliases.join(", ")
                            )),
                        },
                        "identityfile" => block.identity_file = Some(value.to_string()),
                        "proxyjump" => block.proxy_jump = Some(value.to_string()),
                        _ => {}
                    }
                }
            }
        }
    }

    flush_current(
        &mut current,
        &mut parsed_profiles,
        &mut warnings,
        &mut skipped,
    );

    let mut profile_index: HashMap<String, String> = existing_profiles
        .iter()
        .flat_map(|profile| {
            [
                (profile.name.clone(), profile.id.clone()),
                (profile.host.clone(), profile.id.clone()),
            ]
        })
        .collect();

    for profile in &mut parsed_profiles {
        if profile.input.id.is_none() {
            profile.input.id = existing_profiles
                .iter()
                .find(|existing| existing.name == profile.input.name)
                .map(|existing| existing.id.clone());
        }
        let id = profile
            .input
            .id
            .get_or_insert_with(|| Uuid::new_v4().to_string());
        profile_index.insert(profile.input.name.clone(), id.clone());
        profile_index.insert(profile.input.host.clone(), id.clone());
    }

    let imported = parsed_profiles
        .into_iter()
        .map(|mut profile| {
            if profile.input.jump_host_id.is_none() {
                if let Some(proxy_jump) = &profile.proxy_jump {
                    if let Some(jump_host) = proxy_jump_host(proxy_jump) {
                        profile.input.jump_host_id = profile_index.get(&jump_host).cloned();
                        if profile.input.jump_host_id.is_none() {
                            warnings.push(format!(
                                "Imported {} without ProxyJump because the jump host profile was not found.",
                                profile.input.name
                            ));
                        }
                    }
                }
            }
            profile.input
        })
        .collect();

    (imported, skipped, warnings)
}
