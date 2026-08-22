import React from "react";
import {useJoinTeamMutation} from "../utils/reducers/joinSlice";
import {useAddTeamMutation, useDeleteTeamMutation, useGetTeamsQuery} from "../utils/reducers/teamsSlice";
import {PlusIcon, UsersRound, Trash2} from "lucide-react";
import {BeatLoader} from "react-spinners";
import {FormInput, Modal} from "./basicComponents";
import {Chip} from "../components/uiBits";
import {notice} from "../utils/dialogs";

const pill =
    "inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-ink-800 dark:hover:bg-ink-700 text-sm font-semibold transition";


export default function JoinTeamForm({competition, setModalState, user, isOwner}) {

    const {
        data: teams,
        refetch: teamsRefetch,
        isLoading: teamsLoading,
        isFetching: teamsIsFetching,
    } = useGetTeamsQuery();
    const [createTeam, {
    }] = useAddTeamMutation();
    const [deleteTeam, {
    }] = useDeleteTeamMutation();
    const [joinTeam, {
    }] = useJoinTeamMutation();

    const filteredTeams = teams?.filter(item => item.competition === competition?.id);
    const myTeamId = filteredTeams?.find(t => t.user.includes(user?.id))?.id;
    const usedIds = new Set(filteredTeams?.flatMap(team => team?.user));
    const usersWithoutTeams = competition?.user_info?.filter(u => !usedIds.has(u.id));

    async function handleTeamChange(kwargs) {
        await joinTeam(kwargs);
        teamsRefetch();
    };

    async function handleTeamCreate(e) {
        e.preventDefault();
        const result = await createTeam({competition: competition.id, name: e.target.teamName.value});
        if (result?.error || !result?.data?.id) {
            // Without this check result.data.id threw on failure -
            // an unhandled rejection with zero user feedback.
            console.error('Create Team failed:', result?.error);
            await notice('Could not create the team. Please try again.');
            return;
        }
        e.target.reset();
        if (!isOwner) {
            handleTeamChange({team: result.data.id});
        }
    };


    return (
        <Modal title="Teams" landscape={false} setShowModal={setModalState} isLoading={false}>
            {filteredTeams?.map((team, teamidx) => (
                <div key={teamidx} className="rounded-2xl border border-gray-200/70 dark:border-ink-700/60 p-4">
                    <div className="flex justify-between items-center gap-2 mb-2">
                        <h2 className="text-lg font-semibold truncate mr-auto">{team.name}</h2>
                        {((!team.my) ? (
                                    <>
                                        {((isOwner && team.user.length === 0) ? (
                                            <button onClick={() => deleteTeam(team.id)}
                                                    className={pill + " mr-1"} aria-label="Delete team">
                                                <Trash2 className="w-3.5 h-3.5"/>
                                            </button>
                                        ) : null)}
                                        {(!isOwner) && (
                                            <button onClick={() => handleTeamChange({team: team.id})} className={pill}>
                                                <UsersRound className="w-3.5 h-3.5"/>
                                                <span className="break-keep">Join Team</span>
                                            </button>
                                        )}

                                    </>
                                )
                                : <Chip>My Team</Chip>
                        )}
                    </div>
                    <ul className="text-gray-700 dark:text-gray-300 space-y-1">
                        {team?.user_info?.map((user, useridx) => (
                            <li key={useridx} className="flex items-center justify-between gap-2 py-1">
                                <span>{user.username}</span>
                                {(isOwner) && <FormInput width="inline-block w-1/3 text-sm" type="select" placeholder={false} selectList={filteredTeams?.map(team => ({value: team.id, label: team.name}))} setValue={(team_id) => handleTeamChange({user: user.id, team: team_id})} value={team.id}/>}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}

            {(usersWithoutTeams?.length > 0) && (
                <div className="rounded-2xl border border-gray-200/70 dark:border-ink-700/60 p-4">
                    <div className="flex justify-between items-center gap-2 mb-2">
                        <h2 className="text-lg font-semibold truncate mr-auto">Participants without a team</h2>
                        <div className="text-xs text-gray-400">Add them to a team</div>
                    </div>
                    <ul className="text-gray-700 dark:text-gray-300 space-y-1">
                        {usersWithoutTeams?.map((userI, useridx) => (
                            <li key={useridx} className="flex items-center justify-between gap-2 py-1">
                                <span>{userI.username}</span>
                                {(isOwner) ? (
                                    <FormInput width="inline-block w-1/3 text-sm" type="select" selectList={filteredTeams?.map(team => ({value: team.id, label: team.name}))} setValue={(team_id) => handleTeamChange({user: userI.id, team: team_id})} />
                                ) : (userI.id === user?.id || myTeamId === undefined) ? null : (
                                    <button onClick={() => handleTeamChange({user: userI.id, team: myTeamId})} className={pill}>
                                        <UsersRound className="w-3.5 h-3.5"/>
                                        <span className="break-keep">Add to my team</span>
                                    </button>
                                )
                                }
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="rounded-2xl border border-gray-200/70 dark:border-ink-700/60 p-4">
                <h2 className="text-lg font-semibold mb-3">Create a team</h2>
                <form onSubmit={handleTeamCreate} className="flex items-center gap-2">
                    <input
                        type="text"
                        name="teamName"
                        placeholder="Enter team name"
                        required={true}
                        disabled={teamsLoading}
                        className="flex-1 border border-gray-200 dark:border-ink-700/60 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-volt-400 dark:bg-ink-900"
                    />
                    {(teamsLoading || teamsIsFetching) ? (
                        <BeatLoader color="#d7ff3e"/>
                    ) : (
                        <button type="submit" disabled={teamsLoading}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt disabled:opacity-50">
                            <PlusIcon className="w-3.5 h-3.5"/>
                            <span className="break-keep">
                                {(isOwner) ? 'Create': 'Create & Join'}
                            </span>
                        </button>
                    )}
                </form>
            </div>
        </Modal>
    )
}
