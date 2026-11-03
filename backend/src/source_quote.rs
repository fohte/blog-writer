use unicode_normalization::UnicodeNormalization;

pub(crate) fn quote_exists(body: &str, quote: &str) -> bool {
    let normalized_quote = normalize(quote);
    !normalized_quote.is_empty() && normalize(body).contains(&normalized_quote)
}

fn normalize(value: &str) -> String {
    let mut normalized = String::new();
    let mut pending_space = false;

    for character in value.nfkc() {
        if is_markdown_syntax(character) {
            continue;
        }
        if character.is_whitespace() {
            pending_space = !normalized.is_empty();
            continue;
        }
        if pending_space {
            normalized.push(' ');
            pending_space = false;
        }
        normalized.push(character);
    }

    normalized
}

fn is_markdown_syntax(character: char) -> bool {
    matches!(
        character,
        '\\' | '`' | '*' | '_' | '#' | '>' | '[' | ']' | '(' | ')' | '!' | '~' | '|' | '+' | '-'
    )
}

#[cfg(test)]
mod tests;
