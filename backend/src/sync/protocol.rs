use yrs::{
    ClientID, Doc, ReadTxn, Transact, Update,
    encoding::read::Cursor,
    sync::{
        Awareness, Message, Protocol,
        protocol::{DefaultProtocol, MessageReader},
    },
    updates::{
        decoder::DecoderV1,
        encoder::{Encode, Encoder, EncoderV1},
    },
};

pub(super) struct DocumentState {
    awareness: Awareness,
}

impl DocumentState {
    pub(super) fn new(doc: Doc) -> Self {
        Self {
            awareness: Awareness::new(doc),
        }
    }

    pub(super) fn doc(&self) -> &Doc {
        self.awareness.doc()
    }

    pub(super) fn apply_update(&mut self, update: Update) -> Result<(), yrs::error::UpdateError> {
        self.awareness.doc_mut().transact_mut().apply_update(update)
    }

    pub(super) fn remove_awareness_client(&mut self, client_id: ClientID) {
        self.awareness.remove_state(client_id);
    }

    pub(super) fn awareness_update(
        &self,
        client_ids: impl IntoIterator<Item = ClientID>,
    ) -> Result<yrs::sync::AwarenessUpdate, yrs::sync::awareness::Error> {
        self.awareness.update_with_clients(client_ids)
    }
}

pub(super) fn encode_state(state: &DocumentState) -> Vec<u8> {
    state
        .doc()
        .transact()
        .encode_state_as_update_v1(&yrs::StateVector::default())
}

pub(super) fn start(state: &DocumentState) -> Result<Vec<u8>, yrs::sync::protocol::Error> {
    let mut encoder = EncoderV1::new();
    DefaultProtocol.start(&state.awareness, &mut encoder)?;
    Ok(encoder.to_vec())
}

pub(super) fn decode_messages(data: &[u8]) -> Result<Vec<Message>, yrs::encoding::read::Error> {
    let mut decoder = DecoderV1::new(Cursor::new(data));
    MessageReader::new(&mut decoder).collect::<Result<Vec<_>, _>>()
}

pub(super) fn handle_message(
    state: &mut DocumentState,
    message: Message,
) -> Result<Option<Message>, yrs::sync::protocol::Error> {
    DefaultProtocol.handle_message(&mut state.awareness, message)
}

pub(super) fn encode_message(message: &Message) -> Vec<u8> {
    let mut encoder = EncoderV1::new();
    message.encode(&mut encoder);
    encoder.to_vec()
}

pub(super) fn encode_sync_update(update: &[u8]) -> Vec<u8> {
    encode_message(&Message::Sync(yrs::sync::SyncMessage::Update(
        update.to_vec(),
    )))
}
