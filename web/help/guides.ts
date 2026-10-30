import { str } from '../i18n';

export type GuideId = 'library' | 'add' | 'source' | 'machine' | 'room';

export type Block =
  | { p: string }
  | { h: string; at?: string }
  | { ul: string[] }
  | { ol: string[] }
  | { img: string; alt: string };

export interface Guide {
  id: GuideId;
  title: string;
  arcade?: boolean;
  blocks: Block[];
}

export function guides(): Guide[] {
  return [
    {
      id: 'library',
      title: str('help.library'),
      blocks: [
        { img: 'library', alt: str('help.shot_library') },
        { p: str('help.library_1') },
        { p: str('help.library_2') },
        { img: 'library-more', alt: str('help.shot_library_more') },
        { ul: [str('help.library_fresh'), str('help.library_remove')] },
        { p: str('help.library_3') },
      ],
    },
    {
      id: 'add',
      title: str('help.add'),
      blocks: [
        { p: str('help.add_1') },
        { p: str('help.add_2') },
        { p: str('help.add_3') },
        { ul: [str('help.add_folder'), str('help.add_files'), str('help.add_source')] },
        { img: 'add-sheet', alt: str('help.shot_add_sheet') },
        { p: str('help.add_4') },
        { p: str('help.add_5') },
      ],
    },
    {
      id: 'source',
      title: str('help.source'),
      blocks: [
        { p: str('help.source_1') },
        { p: str('help.source_2') },
        { p: str('help.source_intro') },
        { ol: [str('help.source_step1'), str('help.source_step2'), str('help.source_step3'), str('help.source_step4'), str('help.source_step5')] },
        { img: 'source-address', alt: str('help.shot_source_address') },
        { img: 'source-signin', alt: str('help.shot_source_signin') },
        { img: 'source-library', alt: str('help.shot_source_library') },
        { p: str('help.source_3') },
        { p: str('help.source_4') },
        { p: str('help.source_5') },
        { ol: [str('help.source_manage1'), str('help.source_manage2'), str('help.source_manage3')] },
        { img: 'source-menu', alt: str('help.shot_source_menu') },
      ],
    },
    {
      id: 'machine',
      title: str('help.machine'),
      arcade: true,
      blocks: [
        { p: str('help.machine_0') },
        { p: str('help.machine_1') },
        { p: str('help.machine_2') },
        { img: 'machine-pick', alt: str('help.shot_machine_pick') },
        { h: str('help.machine_boot'), at: 'step0' },
        { p: str('help.machine_boot_text') },
        { img: 'machine-boot', alt: str('help.shot_machine_boot') },
        { h: str('help.machine_configure'), at: 'step1' },
        { p: str('help.machine_configure_text') },
        { img: 'machine-configure', alt: str('help.shot_machine_configure') },
        { h: str('help.machine_fill'), at: 'step2' },
        { p: str('help.machine_fill_text') },
        { p: str('help.machine_fill_text2') },
        { h: str('help.machine_look'), at: 'step3' },
        { p: str('help.machine_look_text') },
        { img: 'machine-look', alt: str('help.shot_machine_look') },
        { h: str('help.machine_finish'), at: 'step4' },
        { p: str('help.machine_finish_text') },
        { ul: [str('help.machine_finish_coin'), str('help.machine_finish_start')] },
        { img: 'machine-finish', alt: str('help.shot_machine_finish') },
        { p: str('help.machine_finish_ask') },
        { p: str('help.machine_finish_pass') },
      ],
    },
    {
      id: 'room',
      title: str('help.room'),
      arcade: true,
      blocks: [
        { p: str('help.room_0') },
        { p: str('help.room_1') },
        { img: 'room', alt: str('help.shot_room') },
        { p: str('help.room_2') },
        { p: str('help.room_3') },
        { p: str('help.room_4') },
      ],
    },
  ];
}
