use std::{
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
};

use tempfile::NamedTempFile;

use super::state::FileSyncError;

pub(super) fn read_file(
    directory: &Path,
    relative: &str,
) -> Result<Option<Vec<u8>>, FileSyncError> {
    let path = match resolve_path(directory, relative, false) {
        Ok(path) => path,
        Err(FileSyncError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn atomic_write(
    directory: &Path,
    relative: &str,
    bytes: &[u8],
) -> Result<(), FileSyncError> {
    let path = resolve_path(directory, relative, true)?;
    let parent = path.parent().ok_or(FileSyncError::InvalidPath)?;
    let permissions = match fs::metadata(&path) {
        Ok(metadata) => Some(metadata.permissions()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => new_file_permissions(),
        Err(error) => return Err(error.into()),
    };
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    if let Some(permissions) = permissions {
        temporary.as_file().set_permissions(permissions)?;
    }
    temporary.persist(&path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(unix)]
fn new_file_permissions() -> Option<fs::Permissions> {
    use std::os::unix::fs::PermissionsExt;

    Some(fs::Permissions::from_mode(0o644))
}

#[cfg(not(unix))]
fn new_file_permissions() -> Option<fs::Permissions> {
    None
}

pub(super) fn validate_path(directory: &Path, relative: &str) -> Result<(), FileSyncError> {
    validate_path_syntax(relative)?;
    match resolve_path(directory, relative, false) {
        Ok(_) => Ok(()),
        Err(FileSyncError::Io(error)) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn resolve_path(
    directory: &Path,
    relative: &str,
    create_parents: bool,
) -> Result<PathBuf, FileSyncError> {
    validate_path_syntax(relative)?;
    let path = Path::new(relative);
    if create_parents {
        fs::create_dir_all(directory)?;
    }
    let root = fs::canonicalize(directory)?;
    if contains_git_component(&root) {
        return Err(FileSyncError::InvalidPath);
    }
    let mut current = root.clone();
    let components: Vec<_> = path.components().collect();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else {
            return Err(FileSyncError::InvalidPath);
        };
        current.push(name);
        let is_last = index + 1 == components.len();
        if is_last {
            match fs::symlink_metadata(&current) {
                Ok(metadata) => {
                    let resolved =
                        fs::canonicalize(&current).map_err(|_| FileSyncError::InvalidPath)?;
                    if !resolved.starts_with(&root)
                        || contains_git_component(&resolved)
                        || metadata.is_dir()
                    {
                        return Err(FileSyncError::InvalidPath);
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    let parent = current.parent().ok_or(FileSyncError::InvalidPath)?;
                    let resolved_parent = fs::canonicalize(parent)?;
                    if !resolved_parent.starts_with(&root)
                        || contains_git_component(&resolved_parent)
                    {
                        return Err(FileSyncError::InvalidPath);
                    }
                }
                Err(error) => return Err(error.into()),
            }
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.is_dir() || metadata.file_type().is_symlink() => {
                let resolved =
                    fs::canonicalize(&current).map_err(|_| FileSyncError::InvalidPath)?;
                if !resolved.starts_with(&root)
                    || contains_git_component(&resolved)
                    || !resolved.is_dir()
                {
                    return Err(FileSyncError::InvalidPath);
                }
            }
            Ok(_) => return Err(FileSyncError::InvalidPath),
            Err(error) if error.kind() == io::ErrorKind::NotFound && create_parents => {
                fs::create_dir(&current)?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(current)
}

fn validate_path_syntax(relative: &str) -> Result<(), FileSyncError> {
    let path = Path::new(relative);
    if relative.is_empty()
        || relative.contains('\\')
        || relative.starts_with('/')
        || is_windows_absolute(relative)
        || path.extension().is_none_or(|extension| extension != "md")
        || relative.split('/').any(|component| {
            component.is_empty()
                || matches!(component, "." | "..")
                || component.eq_ignore_ascii_case(".git")
        })
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir
                    | Component::CurDir
                    | Component::RootDir
                    | Component::Prefix(_)
            )
        })
    {
        return Err(FileSyncError::InvalidPath);
    }
    Ok(())
}

fn is_windows_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

fn contains_git_component(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    })
}

pub(super) fn line_endings(body: &[u8], previous: Option<&[u8]>) -> Vec<u8> {
    let crlf = previous.is_some_and(|bytes| bytes.windows(2).any(|window| window == b"\r\n"));
    if !crlf {
        return body.to_vec();
    }
    let mut result = Vec::with_capacity(body.len());
    for (index, byte) in body.iter().copied().enumerate() {
        if byte == b'\n' && (index == 0 || body[index - 1] != b'\r') {
            result.push(b'\r');
        }
        result.push(byte);
    }
    result
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
